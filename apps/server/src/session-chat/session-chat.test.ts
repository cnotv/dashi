import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'

const sessionId = '0f6f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const chatPath = `/api/sessions/${sessionId}/chat`
const githubToken = 'ghp_exampleTokenValue1234567890abcd'

const runnerRequest = (path: string, token: string, body: unknown = {}) =>
  jsonRequest('POST', `/api/runner${path}`, body, { authorization: `Bearer ${token}` })

const transcriptReport = (text: string) => ({
  found: true,
  messages: [
    { messageId: 'm1', role: 'user', kind: 'text', text: 'Fix the marbles', toolName: null, createdAt: '2026-09-30T10:00:00Z' },
    { messageId: 'm2', role: 'assistant', kind: 'text', text, toolName: null, createdAt: '2026-09-30T10:00:05Z' },
  ],
  deliveryRoute: 'tmux',
  sendBlocker: null,
})

const workStartSchema = z.object({ repositoryName: z.string(), startId: z.string(), target: z.string() }).nullable()

const chatWorkSchema = z.object({
  sessions: z.array(z.object({ sessionId: z.string(), sessionState: z.string().nullable(), start: workStartSchema })),
  deliveries: z.array(
    z.object({
      deliveryId: z.string(),
      sessionId: z.string(),
      text: z.string(),
      sessionState: z.string().nullable(),
      start: workStartSchema,
    }),
  ),
})

const sessionChatSchema = z.object({
  availability: z.string(),
  deliveryRoute: z.string(),
  sendBlocker: z.string().nullable(),
  messages: z.array(z.object({ messageId: z.string(), text: z.string() })),
  deliveries: z.array(z.object({ deliveryId: z.string(), state: z.string(), message: z.string().nullable() })),
})

const setUp = () => {
  const clock = { now: Date.parse('2026-09-30T10:00:00Z') }
  const testApp = createTestApp({}, {}, clock)
  const { token } = testApp.runnerTokens.createToken('MacBook')
  const readChat = async () => sessionChatSchema.parse(await (await testApp.app.request(getRequest(chatPath))).json())
  const takeWork = async () => chatWorkSchema.parse(await (await testApp.app.request(runnerRequest('/chat-work', token))).json())
  return { ...testApp, clock, token, readChat, takeWork }
}

describe('session chat', () => {
  it('says no runner is online until one asks for work, then waits for its transcript', async () => {
    const { readChat, takeWork } = setUp()
    expect(await readChat()).toMatchObject({ availability: 'runner-offline', messages: [], deliveryRoute: 'none' })
    await takeWork()
    expect(await readChat()).toMatchObject({ availability: 'waiting-for-runner' })
  })

  it("asks the runner for open drawers' sessions with their state, and shows what it sends back scrubbed", async () => {
    const { app, vault, activityStore, token, clock, readChat, takeWork } = setUp()
    vault.saveSecret('github-token', githubToken)
    activityStore.recordEvent({
      sessionId,
      provider: 'claude',
      state: 'working',
      repository: null,
      branch: null,
      title: null,
      folder: null,
      origin: { launcher: null, terminal: null, launchingApp: null, billing: null, apiHost: null, startId: null },
      occurredAt: new Date(clock.now).toISOString(),
    })
    await readChat()
    expect((await takeWork()).sessions).toEqual([{ sessionId, sessionState: 'working', start: null }])

    const report = transcriptReport(`Pushed with ${githubToken}`)
    expect((await app.request(runnerRequest(`/chat/${sessionId}`, token, report))).status).toBe(204)
    const chat = await readChat()
    expect(chat).toMatchObject({ availability: 'on-laptop', deliveryRoute: 'tmux', sendBlocker: null })
    expect(JSON.stringify(chat)).not.toContain(githubToken)
    expect(chat.messages[1]?.text).toContain('Pushed with')
  })

  it('forgets a transcript once its drawer has been closed for a while, and refuses one nobody asked for', async () => {
    const { app, token, clock, readChat } = setUp()
    expect((await app.request(runnerRequest(`/chat/${sessionId}`, token, transcriptReport('early')))).status).toBe(404)
    await readChat()
    expect((await app.request(runnerRequest(`/chat/${sessionId}`, token, transcriptReport('hello')))).status).toBe(204)
    clock.now += 30_000
    expect((await app.request(runnerRequest(`/chat/${sessionId}`, token, transcriptReport('late')))).status).toBe(404)
    expect(await readChat()).toMatchObject({ messages: [] })
  })

  it('hands a message to the runner once and shows how its delivery ended', async () => {
    const { app, token, readChat, takeWork } = setUp()
    const queued = await app.request(jsonRequest('POST', chatPath, { text: '  Also update the docs  ' }))
    expect(queued.status).toBe(201)
    const { deliveryId } = z.object({ deliveryId: z.string() }).parse(await queued.json())

    expect((await takeWork()).deliveries).toEqual([
      { deliveryId, sessionId, text: 'Also update the docs', sessionState: null, start: null },
    ])
    expect((await takeWork()).deliveries).toEqual([])
    expect((await readChat()).deliveries).toMatchObject([{ deliveryId, state: 'sent' }])

    const deliveredReport = { state: 'delivered', message: null }
    expect((await app.request(runnerRequest(`/deliveries/${deliveryId}`, token, deliveredReport))).status).toBe(204)
    expect((await readChat()).deliveries).toMatchObject([{ deliveryId, state: 'delivered' }])
    expect((await app.request(runnerRequest(`/deliveries/${deliveryId}`, token, deliveredReport))).status).toBe(404)
  })

  it('fails a message the runner took but never confirmed', async () => {
    const { app, clock, readChat, takeWork } = setUp()
    await app.request(jsonRequest('POST', chatPath, { text: 'Hello' }))
    await takeWork()
    clock.now += 150_000
    expect((await readChat()).deliveries).toMatchObject([{ state: 'failed', message: 'The runner did not confirm it' }])
  })

  it('opens the chat of a laptop start from the board, which the runner finds by its worktree', async () => {
    const { app, readChat, takeWork } = setUp()
    const startResponse = await app.request(
      jsonRequest('POST', '/api/session-starts', {
        repository: { owner: 'cnotv', name: 'generative-art' },
        issueNumber: 42,
        workflow: 'fix',
        target: 'laptop-headless',
        permissionMode: 'auto',
        note: '',
      }),
    )
    const { startId } = z.object({ startId: z.string() }).parse(await startResponse.json())
    const startChatPath = `/api/session-starts/${startId}/chat`

    expect(sessionChatSchema.parse(await (await app.request(getRequest(startChatPath))).json())).toMatchObject({ messages: [] })
    expect((await app.request(jsonRequest('POST', startChatPath, { text: 'Carry on' }))).status).toBe(201)
    const work = await takeWork()
    const start = { repositoryName: 'generative-art', startId, target: 'laptop-headless' }
    expect(work.sessions).toEqual([{ sessionId: `start-${startId}`, sessionState: null, start }])
    expect(work.deliveries).toMatchObject([{ sessionId: `start-${startId}`, text: 'Carry on', start }])
    expect((await readChat()).messages).toEqual([])
  })

  it('refuses a start that does not exist, and a start id passed as a session', async () => {
    const { app } = setUp()
    expect((await app.request(getRequest('/api/session-starts/0123abcd-0000-4000-8000-000000000000/chat'))).status).toBe(404)
    expect((await app.request(getRequest('/api/sessions/start-0123abcd-0000-4000-8000-000000000000/chat'))).status).toBe(404)
  })

  it('refuses a malformed session id, an empty message, and a runner without a token', async () => {
    const { app } = setUp()
    expect((await app.request(getRequest('/api/sessions/..%2Fetc/chat'))).status).toBe(404)
    expect((await app.request(jsonRequest('POST', chatPath, { text: '   ' }))).status).toBe(400)
    expect((await app.request(runnerRequest('/chat-work', 'adr_wrong'))).status).toBe(401)
  })
})
