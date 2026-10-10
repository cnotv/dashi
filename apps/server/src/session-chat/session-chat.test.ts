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
  sessions: z.array(
    z.object({ sessionId: z.string(), sessionState: z.string().nullable(), start: workStartSchema, openRouterModel: z.string().nullable() }),
  ),
  deliveries: z.array(
    z.object({
      deliveryId: z.string(),
      sessionId: z.string(),
      text: z.string(),
      sessionState: z.string().nullable(),
      start: workStartSchema,
      openRouterModel: z.string().nullable(),
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
    expect((await takeWork()).sessions).toEqual([{ sessionId, sessionState: 'working', start: null, openRouterModel: null }])

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
      { deliveryId, sessionId, text: 'Also update the docs', sessionState: null, start: null, openRouterModel: null },
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

  it('opens the chat of a laptop start from the board, which the runner finds by its worktree and resumes on its model', async () => {
    const { app, readChat, takeWork } = setUp()
    const startResponse = await app.request(
      jsonRequest('POST', '/api/session-starts', {
        repository: { owner: 'cnotv', name: 'generative-art' },
        issueNumber: 42,
        workflow: 'fix',
        target: 'laptop-headless',
        permissionMode: 'auto',
        openRouterModel: 'openai/gpt-5-mini',
        note: '',
      }),
    )
    const { startId } = z.object({ startId: z.string() }).parse(await startResponse.json())
    const startChatPath = `/api/session-starts/${startId}/chat`

    expect(sessionChatSchema.parse(await (await app.request(getRequest(startChatPath))).json())).toMatchObject({ messages: [] })
    expect((await app.request(jsonRequest('POST', startChatPath, { text: 'Carry on' }))).status).toBe(201)
    const work = await takeWork()
    const start = { repositoryName: 'generative-art', startId, target: 'laptop-headless' }
    const openRouterModel = 'openai/gpt-5-mini'
    expect(work.sessions).toEqual([{ sessionId: `start-${startId}`, sessionState: null, start, openRouterModel }])
    expect(work.deliveries).toMatchObject([{ sessionId: `start-${startId}`, text: 'Carry on', start, openRouterModel }])
    expect((await readChat()).messages).toEqual([])
  })

  it("resumes a session opened from its row on the OpenRouter model of the board start it reported", async () => {
    const { app, activityStore, clock, takeWork } = setUp()
    const startResponse = await app.request(
      jsonRequest('POST', '/api/session-starts', {
        repository: { owner: 'cnotv', name: 'generative-art' },
        issueNumber: 42,
        workflow: 'fix',
        target: 'laptop-headless',
        openRouterModel: 'openai/gpt-5-mini',
      }),
    )
    const { startId } = z.object({ startId: z.string() }).parse(await startResponse.json())
    activityStore.recordEvent({
      sessionId,
      provider: 'claude',
      state: 'idle',
      repository: null,
      branch: null,
      title: null,
      folder: null,
      origin: { launcher: null, terminal: null, launchingApp: null, billing: null, apiHost: 'openrouter.ai', startId },
      occurredAt: new Date(clock.now).toISOString(),
    })
    expect((await app.request(jsonRequest('POST', chatPath, { text: 'Carry on' }))).status).toBe(201)
    expect((await takeWork()).deliveries).toMatchObject([{ sessionId, start: null, openRouterModel: 'openai/gpt-5-mini' }])
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

describe('cloud session chat', () => {
  const routineToken = 'sk-ant-oat01-exampleRoutineToken0123456789'
  const hookSessionId = '9a8b7c6d-0000-4000-8000-000000000000'
  const cloudWorkSchema = z.object({
    deliveries: z.array(z.object({ deliveryId: z.string(), sessionId: z.string(), text: z.string(), cloudSessionId: z.string().nullable() })),
  })

  const setUpRoutineStart = async () => {
    const testApp = setUp()
    const { token: ingestToken } = testApp.ingestTokens.createToken('Claude cloud')
    await testApp.app.request(
      jsonRequest('PUT', '/api/repositories/cnotv/generative-art/routine', { routineId: 'trig_01ABCDEFGHJK', token: routineToken }),
    )
    const startBody = { repository: { owner: 'cnotv', name: 'generative-art' }, issueNumber: 42, workflow: 'fix', target: 'cloud-routine', note: '' }
    const startId = z.object({ startId: z.string() }).parse(await (await testApp.app.request(jsonRequest('POST', '/api/session-starts', startBody))).json()).startId
    const reportHook = (payload: Record<string, unknown>, cloudSession = 'cse_01Fired') =>
      testApp.app.request(
        jsonRequest('POST', '/api/events', { session_id: hookSessionId, ...payload }, { authorization: `Bearer ${ingestToken}`, 'x-agent-cloud-session': cloudSession }),
      )
    const readStartChat = async () => sessionChatSchema.parse(await (await testApp.app.request(getRequest(`/api/session-starts/${startId}/chat`))).json())
    return { ...testApp, startId, reportHook, readStartChat }
  }

  it("shows a routine start's prompts and final replies from its hooks, scrubbed of stored secrets", async () => {
    const { vault, reportHook, readStartChat } = await setUpRoutineStart()
    vault.saveSecret('github-token', githubToken)
    await reportHook({ hook_event_name: 'SessionStart' })
    await reportHook({ hook_event_name: 'UserPromptSubmit', prompt: '/workflow:start fix https://github.com/cnotv/generative-art/issues/42' })
    await reportHook({ hook_event_name: 'Stop', last_assistant_message: `Opened the draft pull request; pushed with ${githubToken}` })
    await reportHook({ hook_event_name: 'Stop', last_assistant_message: 'Not this session' }, 'cse_01Another')

    const chat = await readStartChat()
    expect(chat).toMatchObject({ availability: 'in-cloud', deliveryRoute: 'none', sendBlocker: expect.stringContaining('laptop runner') })
    expect(chat.messages.map((message) => message.text)).toEqual([
      '/workflow:start fix https://github.com/cnotv/generative-art/issues/42',
      'Opened the draft pull request; pushed with [redacted]',
    ])
  })

  it('opens the same chat from the Sessions table, by the session id its hooks report', async () => {
    const { app, reportHook } = await setUpRoutineStart()
    await reportHook({ hook_event_name: 'Stop', last_assistant_message: 'Done' })
    const chat = sessionChatSchema.parse(await (await app.request(getRequest(`/api/sessions/${hookSessionId}/chat`))).json())
    expect(chat).toMatchObject({ availability: 'in-cloud', messages: [{ text: 'Done' }] })
  })

  it('hands a message to the runner with the cloud session to send it to, and shows how it went', async () => {
    const { app, token, startId, readStartChat } = await setUpRoutineStart()
    await app.request(runnerRequest('/chat-work', token))
    expect(await readStartChat()).toMatchObject({ deliveryRoute: 'cloud', sendBlocker: null })

    expect((await app.request(jsonRequest('POST', `/api/session-starts/${startId}/chat`, { text: 'Also update the README' }))).status).toBe(201)
    const work = cloudWorkSchema.parse(await (await app.request(runnerRequest('/chat-work', token))).json())
    expect(work.deliveries).toEqual([
      { deliveryId: expect.any(String), sessionId: 'session_01Fired', text: 'Also update the README', cloudSessionId: 'session_01Fired' },
    ])
    const deliveryId = work.deliveries[0]?.deliveryId ?? ''
    expect((await app.request(runnerRequest(`/deliveries/${deliveryId}`, token, { state: 'delivered', message: null }))).status).toBe(204)
    expect((await readStartChat()).deliveries).toEqual([expect.objectContaining({ deliveryId, state: 'delivered' })])
  })

  it('ignores a hook that names no cloud session, or a malformed one', async () => {
    const { reportHook, readStartChat } = await setUpRoutineStart()
    await reportHook({ hook_event_name: 'Stop', last_assistant_message: 'From a laptop' }, '')
    await reportHook({ hook_event_name: 'Stop', last_assistant_message: 'Forged' }, 'cse_../../x')
    expect((await readStartChat()).messages).toEqual([])
  })
})
