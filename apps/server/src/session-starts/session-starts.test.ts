import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDraftGithub, createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'
import { sessionNameFor, sessionPromptFor, statusReportingSectionFor } from './prompt.ts'

const repository = { owner: 'cnotv', name: 'generative-art' }
const startBody = (overrides: Record<string, unknown> = {}) => ({
  repository,
  issueNumber: 42,
  workflow: 'fix',
  target: 'laptop-remote-control',
  permissionMode: 'auto',
  note: '',
  ...overrides,
})
const routineToken = 'sk-ant-oat01-exampleRoutineToken0123456789'

const startIdOf = async (response: Response): Promise<string> => z.object({ startId: z.string() }).parse(await response.json()).startId

const runnerRequest = (path: string, token: string, body: unknown = {}) =>
  jsonRequest('POST', `/api/runner${path}`, body, { authorization: `Bearer ${token}` })

describe('a start on a pull request', () => {
  const githubToken = 'ghp_exampleTokenValue1234567890abcd'

  it('turns the pull request back into a draft before the session starts on it', async () => {
    const github = createDraftGithub(false)
    const { app, vault } = createTestApp({ createGraphqlFetcher: github.createGraphqlFetcher })
    vault.saveSecret('github-token', githubToken)
    const response = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ workflow: 'conflicts', pullRequestNumber: 43 })))
    expect(response.status).toBe(201)
    expect(github.receivedCalls.map((call) => call.variables)).toEqual([
      { owner: 'cnotv', name: 'generative-art', number: 43 },
      { pullRequestId: 'PR_kwDraft' },
    ])
  })

  it('still starts when GitHub refuses, and leaves an issue start\'s pull request alone', async () => {
    const github = createDraftGithub(false, { errors: [{ message: 'Resource not accessible by integration' }] })
    const { app, vault } = createTestApp({ createGraphqlFetcher: github.createGraphqlFetcher })
    vault.saveSecret('github-token', githubToken)
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ pullRequestNumber: 43 })))).status).toBe(201)
    const callsBefore = github.receivedCalls.length
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody()))).status).toBe(201)
    expect(github.receivedCalls).toHaveLength(callsBefore)
  })
})

describe('sessionPromptFor', () => {
  const startId = '3f2b8c1e-0a4d-4e6f-9b7a-1c2d3e4f5a6b'

  it('names the workflow for the router, links the issue and adds the note', () => {
    expect(sessionPromptFor({ startId, repository, issueNumber: 42, pullRequestNumber: null, workflow: 'fix', note: 'Only the physics.' }, [])).toBe(
      `/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\nOnly the physics.\n\n${statusReportingSectionFor(startId)}`,
    )
    expect(sessionPromptFor({ startId, repository, issueNumber: null, pullRequestNumber: null, workflow: 'research', note: '' }, [])).toBe(
      `/workflow:start research\n\n${statusReportingSectionFor(startId)}`,
    )
    expect(sessionNameFor({ repository, issueNumber: 42, pullRequestNumber: null, workflow: 'fix' })).toBe('generative-art #42 fix')
  })

  it('points a conflicts start at its pull request', () => {
    const conflictsStart = { startId, repository, issueNumber: 42, pullRequestNumber: 43, workflow: 'conflicts' as const, note: '' }
    expect(sessionPromptFor(conflictsStart, [])).toBe(`/workflow:start conflicts https://github.com/cnotv/generative-art/pull/43\n\n${statusReportingSectionFor(startId)}`)
    expect(sessionNameFor(conflictsStart)).toBe('generative-art #43 conflicts')
  })
})

describe('attachments', () => {
  const startId = '3f2b8c1e-0a4d-4e6f-9b7a-1c2d3e4f5a6b'
  const screenshot = { name: 'ramp.png', mediaType: 'image/png', base64: Buffer.from('not really a png').toString('base64') }

  it('carries the attachments of a session that only takes text inside its prompt', () => {
    const prompt = sessionPromptFor({ startId, repository, issueNumber: 42, pullRequestNumber: null, workflow: 'fix', note: 'See the image.' }, [screenshot])
    expect(prompt).toBe(
      [
        '/workflow:start fix https://github.com/cnotv/generative-art/issues/42',
        'See the image.',
        statusReportingSectionFor(startId),
        'Attachments, as base64. Decode each into a file outside the repository with `base64 -d` and read it:',
        `ramp.png (image/png):\n\`\`\`base64\n${screenshot.base64}\n\`\`\``,
      ].join('\n\n'),
    )
  })

  it('hands a laptop start its files once, with the claim, and never stores them', async () => {
    const { app, runnerTokens, database } = createTestApp()
    const { token } = runnerTokens.createToken('Mac mini')
    const queuedResponse = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ attachments: [screenshot] })))
    expect(queuedResponse.status).toBe(201)
    const attachedStartId = await startIdOf(queuedResponse.clone())
    expect(JSON.stringify(database.prepare('SELECT * FROM session_starts').all())).not.toContain(screenshot.base64)
    expect(await (await app.request(getRequest('/api/session-starts'))).text()).not.toContain(screenshot.base64)

    const claim = await (await app.request(runnerRequest('/claim', token))).json()
    expect(claim).toMatchObject({ prompt: `/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\n${statusReportingSectionFor(attachedStartId)}`, attachments: [screenshot] })

    await app.request(jsonRequest('POST', '/api/session-starts', startBody()))
    expect(await (await app.request(runnerRequest('/claim', token))).json()).toMatchObject({ attachments: [] })
  })

  it('puts the attachments of a laptop cloud start inside its prompt', async () => {
    const { app, runnerTokens } = createTestApp()
    const { token } = runnerTokens.createToken('Mac mini')
    await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'laptop-cloud', attachments: [screenshot] })))
    const claim = z.object({ prompt: z.string(), attachments: z.array(z.unknown()) }).parse(await (await app.request(runnerRequest('/claim', token))).json())
    expect(claim.prompt).toContain(screenshot.base64)
    expect(claim.attachments).toEqual([])
  })

  it('sends a routine its attachments inside the prompt', async () => {
    const { app, firedRoutines } = createTestApp()
    await app.request(jsonRequest('PUT', '/api/repositories/cnotv/generative-art/routine', { routineId: 'trig_01ABCDEFGHJK', token: routineToken }))
    await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine', attachments: [screenshot] })))
    expect(firedRoutines[0]?.text).toContain(screenshot.base64)
  })

  it('refuses attachments too large for the session, unsafe names and repeated names', async () => {
    const { app } = createTestApp()
    const largeFile = { name: 'large.bin', mediaType: 'application/octet-stream', base64: Buffer.alloc(41 * 1024).toString('base64') }
    const tooLarge = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'laptop-cloud', attachments: [largeFile] })))
    expect(tooLarge.status).toBe(413)
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ attachments: [largeFile] })))).status).toBe(201)
    const unsafeName = { ...screenshot, name: '../.ssh/authorized_keys' }
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ attachments: [unsafeName] })))).status).toBe(400)
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ attachments: [screenshot, screenshot] })))).status).toBe(400)
  })
})

describe('details, retry and routine tests', () => {
  const saveRoutine = (app: ReturnType<typeof createTestApp>['app']) =>
    app.request(jsonRequest('PUT', '/api/repositories/cnotv/generative-art/routine', { routineId: 'trig_01ABCDEFGHJK', token: routineToken }))

  it('shows a start with the first message it sent', async () => {
    const { app } = createTestApp()
    const startId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody({ note: 'Keep it small' }))))
    expect(await (await app.request(getRequest(`/api/session-starts/${startId}`))).json()).toMatchObject({
      start: { startId, state: 'queued' },
      firstMessage: `/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\nKeep it small\n\n${statusReportingSectionFor(startId)}`,
    })
    expect((await app.request(getRequest('/api/session-starts/unknown'))).status).toBe(404)
  })

  it('retries a failed start as a new one and keeps the failed one', async () => {
    const { app, startStore, firedRoutines } = createTestApp()
    await saveRoutine(app)
    const failedId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine' }))))
    startStore.recordOutcome(failedId, { state: 'failed', sessionUrl: null, message: 'Authentication failed' })
    const retried = z.object({ startId: z.string(), state: z.string() }).parse(
      await (await app.request(jsonRequest('POST', `/api/session-starts/${failedId}/retry`, {}))).json(),
    )
    expect(retried.startId).not.toBe(failedId)
    expect(retried.state).toBe('started')
    expect(firedRoutines).toHaveLength(2)
    expect(startStore.readStart(failedId)?.state).toBe('failed')
  })

  it('deletes a start and says so when it is gone', async () => {
    const { app, startStore } = createTestApp()
    const startId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody())))
    expect((await app.request(jsonRequest('DELETE', `/api/session-starts/${startId}`, {}))).status).toBe(204)
    expect(startStore.readStart(startId)).toBeNull()
    expect((await app.request(jsonRequest('DELETE', `/api/session-starts/${startId}`, {}))).status).toBe(404)
  })

  it('keeps the state an agent reports, behind an ingest token, and says when the start is unknown', async () => {
    const { app, startStore, ingestTokens } = createTestApp()
    const startId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody())))
    const statusPath = `/api/session-starts/${startId}/status`
    const report = { status: 'waiting', note: 'Which of the two layouts?' }
    expect((await app.request(jsonRequest('POST', statusPath, report))).status).toBe(401)
    const { token } = ingestTokens.createToken('laptop')
    const authorization = { authorization: `Bearer ${token}` }
    expect((await app.request(jsonRequest('POST', statusPath, report, authorization))).status).toBe(204)
    expect(startStore.readStart(startId)).toMatchObject({ agentStatus: 'waiting', agentStatusNote: 'Which of the two layouts?' })
    expect((await app.request(jsonRequest('POST', statusPath, { status: 'sleeping' }, authorization))).status).toBe(400)
    expect((await app.request(jsonRequest('POST', '/api/session-starts/unknown/status', report, authorization))).status).toBe(404)
  })

  it('retries only failed starts', async () => {
    const { app } = createTestApp()
    const startId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody())))
    expect((await app.request(jsonRequest('POST', `/api/session-starts/${startId}/retry`, {}))).status).toBe(409)
  })

  it('tests a routine with a run told to change nothing', async () => {
    const { app, firedRoutines } = createTestApp()
    expect((await app.request(jsonRequest('POST', '/api/repositories/cnotv/generative-art/routine/test', {}))).status).toBe(412)
    await saveRoutine(app)
    const testResponse = await app.request(jsonRequest('POST', '/api/repositories/cnotv/generative-art/routine/test', {}))
    expect(await testResponse.json()).toEqual({ ok: true, sessionUrl: 'https://claude.ai/code/session_01Fired' })
    expect(firedRoutines[0]?.text).toContain('Do not change any file')
  })

  it('refuses a routine first message longer than the routines API takes', async () => {
    const { app, firedRoutines, startStore } = createTestApp()
    await saveRoutine(app)
    const response = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine', note: 'x'.repeat(20000) })))
    expect(response.status).toBe(201)
    const fortyKilobytes = { name: 'shot.png', mediaType: 'image/png', base64: Buffer.alloc(40 * 1024).toString('base64') }
    const withAttachment = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine', attachments: [fortyKilobytes] })))
    expect(withAttachment.status).toBe(201)
    const tooLong = await app.request(
      jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine', note: 'x'.repeat(20000), attachments: [fortyKilobytes] })),
    )
    expect(tooLong.status).toBe(413)
    expect(firedRoutines).toHaveLength(2)
    expect(startStore.listRecentStarts()).toHaveLength(2)
  })

  it('describes the runner script it serves with its hash', async () => {
    const { app } = createTestApp()
    const script = await (await app.request(getRequest('/api/runner/script'))).text()
    const info = z.object({ sha256: z.string(), byteLength: z.number() }).parse(await (await app.request(getRequest('/api/runner/script-info'))).json())
    expect(info.byteLength).toBe(Buffer.byteLength(script))
    expect(info.sha256).toBe(createHash('sha256').update(script).digest('hex'))
  })
})

describe('laptop starts', () => {
  it('queues a start that a runner claims once, then reports on', async () => {
    const { app, runnerTokens } = createTestApp()
    const { token } = runnerTokens.createToken('Mac mini')
    const queuedResponse = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ note: 'Keep it small' })))
    expect(await queuedResponse.clone().json()).toMatchObject({ state: 'queued', target: 'laptop-remote-control', runnerLabel: null })
    const queuedStartId = await startIdOf(queuedResponse)

    const claimResponse = await app.request(runnerRequest('/claim', token))
    expect(await claimResponse.json()).toMatchObject({
      start: { startId: queuedStartId, state: 'claimed', runnerLabel: 'Mac mini' },
      prompt: `/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\nKeep it small\n\n${statusReportingSectionFor(queuedStartId)}`,
      sessionName: 'generative-art #42 fix',
    })
    expect((await app.request(runnerRequest('/claim', token))).status).toBe(204)

    const reportResponse = await app.request(runnerRequest(`/starts/${queuedStartId}`, token, { state: 'started', message: 'In tmux' }))
    expect(await reportResponse.json()).toMatchObject({ state: 'started', message: 'In tmux' })
    expect(await (await app.request(getRequest('/api/session-starts'))).json()).toEqual([
      expect.objectContaining({ startId: queuedStartId, state: 'started' }),
    ])
  })

  it('shows a runner as online while it keeps asking', async () => {
    const clock = { now: Date.parse('2026-09-30T10:00:00Z') }
    const { app, runnerTokens } = createTestApp({}, {}, clock)
    const { token } = runnerTokens.createToken('Mac mini')
    await app.request(runnerRequest('/claim', token))
    const optionsPath = '/api/start-options?owner=cnotv&name=generative-art'
    expect(await (await app.request(getRequest(optionsPath))).json()).toEqual({
      runners: [{ label: 'Mac mini', lastSeenAt: '2026-09-30T10:00:00.000Z', isOnline: true }],
      routineConfigured: false,
      attachmentLimits: { fileCount: 5, fileTargetBytes: 8 * 1024 * 1024, inlineTargetBytes: 40 * 1024 },
    })
    clock.now += 60_000
    expect(await (await app.request(getRequest(optionsPath))).json()).toMatchObject({ runners: [{ isOnline: false }] })
  })

  it('refuses the runner routes without a runner token, even an ingest token', async () => {
    const { app, ingestTokens } = createTestApp()
    const { token } = ingestTokens.createToken('laptop')
    expect((await app.request(runnerRequest('/claim', token))).status).toBe(401)
    expect((await app.request(runnerRequest('/claim', 'adr_made-up'))).status).toBe(401)
  })

  it('lets a runner report only on starts it claimed', async () => {
    const { app, runnerTokens } = createTestApp()
    const first = runnerTokens.createToken('Mac mini').token
    const second = runnerTokens.createToken('Laptop').token
    const queuedStartId = await startIdOf(await app.request(jsonRequest('POST', '/api/session-starts', startBody())))
    await app.request(runnerRequest('/claim', first))
    expect((await app.request(runnerRequest(`/starts/${queuedStartId}`, second, { state: 'started' }))).status).toBe(404)
  })

  it('refuses repositories that are not configured and workflows the router does not know', async () => {
    const { app } = createTestApp()
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ repository: { owner: 'someone', name: 'else' } })))).status).toBe(404)
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ workflow: 'rm -rf' })))).status).toBe(400)
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ permissionMode: 'bypassPermissions' })))).status).toBe(400)
  })

  it('serves the runner script without a sign-in', async () => {
    const { app } = createTestApp({}, { signInRequired: true })
    const scriptResponse = await app.request(getRequest('/api/runner/script'))
    expect(scriptResponse.status).toBe(200)
    expect(await scriptResponse.text()).toContain('DASHI_RUNNER_TOKEN')
    expect((await app.request(getRequest('/api/session-starts'))).status).toBe(401)
  })
})

describe('cloud routine starts', () => {
  it('fires the repository routine with the prompt and keeps the session link', async () => {
    const { app, firedRoutines } = createTestApp()
    const saveResponse = await app.request(
      jsonRequest('PUT', '/api/repositories/cnotv/generative-art/routine', { routineId: 'trig_01ABCDEFGHJK', token: routineToken }),
    )
    expect(saveResponse.status).toBe(204)
    const settingsText = await (await app.request(getRequest('/api/repositories/cnotv/generative-art/routine'))).text()
    expect(JSON.parse(settingsText)).toEqual({ configured: true, routineId: 'trig_01ABCDEFGHJK' })
    expect(settingsText).not.toContain(routineToken)

    const startedResponse = await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine' })))
    const routineStartId = await startIdOf(startedResponse.clone())
    const started = await startedResponse.json()
    expect(started).toMatchObject({ state: 'started', sessionUrl: 'https://claude.ai/code/session_01Fired' })
    expect(firedRoutines).toEqual([
      { routineId: 'trig_01ABCDEFGHJK', routineToken, text: `/workflow:start fix https://github.com/cnotv/generative-art/issues/42\n\n${statusReportingSectionFor(routineStartId)}` },
    ])
  })

  it('asks for a routine before firing one', async () => {
    const { app } = createTestApp()
    expect((await app.request(jsonRequest('POST', '/api/session-starts', startBody({ target: 'cloud-routine' })))).status).toBe(412)
  })
})
