import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'
import { createActivityStore } from './activity-store.ts'
import { buildTimeline, buildUsageReport, effectiveState, inactiveAfterMilliseconds, startFolderNameOf } from './aggregate.ts'
import { startFolderNameFor } from '../../../runner/src/runner.ts'
import { agentEventFrom, repositoryFromRemote, tokenUsagePointsFrom } from './ingest.ts'
import type { StoredSession, StoredTokenSample, TokenUsagePoint } from './types.ts'

const createdTokenSchema = z.object({ token: z.string(), summary: z.object({ tokenId: z.string() }) })

const at = (minutes: number): string => new Date(Date.UTC(2026, 8, 29, 12, minutes)).toISOString()
const atMilliseconds = (minutes: number): number => Date.parse(at(minutes))

const tokenMetrics = (
  sessionId: string,
  points: Array<{ type: string; value: number }>,
  temporality = 1,
  resourceAttributes: Record<string, string> = {},
) => ({
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } },
          ...Object.entries(resourceAttributes).map(([key, stringValue]) => ({ key, value: { stringValue } })),
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: 'claude_code.token.usage',
              sum: {
                aggregationTemporality: temporality,
                dataPoints: points.map(({ type, value }) => ({
                  attributes: [
                    { key: 'session.id', value: { stringValue: sessionId } },
                    { key: 'type', value: { stringValue: type } },
                    { key: 'model', value: { stringValue: 'claude-opus-5-5' } },
                  ],
                  startTimeUnixNano: String(BigInt(atMilliseconds(0)) * 1_000_000n),
                  timeUnixNano: String(BigInt(atMilliseconds(5)) * 1_000_000n),
                  asInt: String(value),
                })),
              },
            },
            { name: 'claude_code.cost.usage', sum: { dataPoints: [] } },
          ],
        },
      ],
    },
  ],
})

describe('repositoryFromRemote', () => {
  it('reads https, ssh, scp-style and proxied remotes', () => {
    const expected = { owner: 'cnotv', name: 'generative-art' }
    expect(repositoryFromRemote('https://github.com/cnotv/generative-art.git')).toEqual(expected)
    expect(repositoryFromRemote('git@github.com:cnotv/generative-art.git')).toEqual(expected)
    expect(repositoryFromRemote('ssh://git@github.com/cnotv/generative-art')).toEqual(expected)
    expect(repositoryFromRemote('http://local_proxy@127.0.0.1:44291/git/cnotv/generative-art')).toEqual(expected)
    expect(repositoryFromRemote('')).toBeNull()
    expect(repositoryFromRemote(undefined)).toBeNull()
  })
})

describe('agentEventFrom', () => {
  const headers = { provider: 'claude', branch: 'feat/12-sessions', remote: 'git@github.com:cnotv/dashi.git', cwd: undefined }

  it('maps Claude hook events to session states', () => {
    const states = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'].map(
      (hookEventName) => agentEventFrom({ session_id: 's1', hook_event_name: hookEventName }, headers, at(0))?.state,
    )
    expect(states).toEqual(['idle', 'working', 'waiting', 'idle', 'ended'])
  })

  it('ties the session to its repository and branch', () => {
    expect(agentEventFrom({ session_id: 's1', hook_event_name: 'UserPromptSubmit' }, headers, at(0))).toEqual({
      sessionId: 's1',
      provider: 'claude',
      state: 'working',
      repository: { owner: 'cnotv', name: 'dashi' },
      branch: 'feat/12-sessions',
      title: null,
      folder: null,
      occurredAt: at(0),
    })
  })

  it("titles a session by its first prompt's first line, and names its folder", () => {
    const longLine = `Show the frame time in the corner ${'and more '.repeat(10)}`
    const event = agentEventFrom(
      { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: '\n  Fix the marbles\nThey stick to the ramp.', cwd: '/Users/me/code/marbles/' },
      { ...headers, remote: '' },
      at(0),
    )
    expect(event).toMatchObject({ title: 'Fix the marbles', folder: 'marbles', repository: null })
    const longTitle = agentEventFrom({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: longLine }, headers, at(0))?.title ?? ''
    expect(longTitle.length).toBeLessThanOrEqual(80)
    expect(longTitle.endsWith('…')).toBe(true)
    const codex = agentEventFrom({ type: 'agent-turn-complete', 'thread-id': 't1', 'input-messages': ['Rename the cookie'] }, { ...headers, provider: 'codex', cwd: '/home/me/dashi' }, at(0))
    expect(codex).toMatchObject({ title: 'Rename the cookie', folder: 'dashi' })
  })

  it('reads a Codex turn and ignores events it does not know', () => {
    expect(agentEventFrom({ type: 'agent-turn-complete', 'thread-id': 't1' }, { ...headers, provider: 'codex' }, at(0))?.state).toBe(
      'idle',
    )
    expect(agentEventFrom({ session_id: 's1', hook_event_name: 'PreToolUse' }, headers, at(0))).toBeNull()
    expect(agentEventFrom({ hook_event_name: 'Stop' }, headers, at(0))).toBeNull()
  })

  it('treats a detached HEAD as no branch', () => {
    expect(agentEventFrom({ session_id: 's1', hook_event_name: 'Stop' }, { ...headers, branch: 'HEAD' }, at(0))?.branch).toBeNull()
  })
})

describe('tokenUsagePointsFrom', () => {
  it('keeps only token usage with a session and a known type', () => {
    const points = tokenUsagePointsFrom(
      tokenMetrics('s1', [
        { type: 'input', value: 120 },
        { type: 'output', value: 40 },
        { type: 'bogus', value: 9 },
      ]),
      at(9),
    )
    expect(points).toEqual([
      expect.objectContaining({ sessionId: 's1', tokenType: 'input', value: 120, model: 'claude-opus-5-5', observedAt: at(5) }),
      expect.objectContaining({ sessionId: 's1', tokenType: 'output', value: 40, isCumulative: false }),
    ])
  })

  it('reads the account and how the session was launched, preferring a cloud session over the entrypoint', () => {
    const pointOf = (resourceAttributes: Record<string, string>) =>
      tokenUsagePointsFrom(tokenMetrics('s1', [{ type: 'input', value: 1 }], 1, resourceAttributes), at(9))[0]
    expect(pointOf({ 'user.email': 'me@example.com', 'organization.id': 'org-1', 'app.entrypoint': 'cli' })).toMatchObject({
      account: 'me@example.com',
      launchHint: 'cli',
    })
    expect(pointOf({ 'organization.id': 'org-1', 'ccr.session.id': 'cse_01abc', 'app.entrypoint': 'cli' })).toMatchObject({
      account: 'org:org-1',
      launchHint: 'cloud:cse_01abc',
    })
    expect(pointOf({})).toMatchObject({ account: null, launchHint: null })
  })
})

describe('activity store', () => {
  const point = (value: number, isCumulative: boolean): TokenUsagePoint => ({
    sessionId: 's1',
    model: 'claude-opus-5-5',
    tokenType: 'output',
    value,
    isCumulative,
    seriesStart: at(0),
    observedAt: at(1),
    account: null,
    launchHint: null,
  })

  it('adds delta reports and takes only the growth of cumulative ones', () => {
    const store = createActivityStore(new DatabaseSync(':memory:'))
    store.recordTokenUsage([point(100, false)], null)
    store.recordTokenUsage([point(50, false)], null)
    store.recordTokenUsage([point(300, true)], null)
    store.recordTokenUsage([point(340, true)], null)
    store.recordTokenUsage([point(340, true)], null)
    expect(store.readTokenSamplesSince(at(0)).map((sample) => sample.tokens)).toEqual([100, 50, 300, 40])
  })

  it('keeps the last known repository when a later event has none', () => {
    const store = createActivityStore(new DatabaseSync(':memory:'))
    const base = { sessionId: 's1', provider: 'claude' as const, occurredAt: at(0) }
    store.recordEvent({ ...base, state: 'working', repository: { owner: 'cnotv', name: 'x' }, branch: 'feat/1-a', title: null, folder: 'x' })
    store.recordEvent({ ...base, state: 'idle', repository: null, branch: null, title: null, folder: null, occurredAt: at(3) })
    expect(store.readSessions()).toEqual([
      expect.objectContaining({ state: 'idle', repository: { owner: 'cnotv', name: 'x' }, branch: 'feat/1-a', folder: 'x', startedAt: at(0) }),
    ])
  })

  it('keeps the first title a session gets', () => {
    const store = createActivityStore(new DatabaseSync(':memory:'))
    const base = { sessionId: 's1', provider: 'claude' as const, repository: null, branch: null, folder: null }
    store.recordEvent({ ...base, state: 'working', title: 'Fix the marbles', occurredAt: at(0) })
    store.recordEvent({ ...base, state: 'working', title: 'yes, go on', occurredAt: at(2) })
    expect(store.readSessions()[0]?.title).toBe('Fix the marbles')
  })

  it('adds the title and folder columns to a database from before them', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`CREATE TABLE agent_sessions (session_id TEXT PRIMARY KEY, provider TEXT NOT NULL, repository_owner TEXT,
      repository_name TEXT, branch TEXT, state TEXT NOT NULL, started_at TEXT NOT NULL, last_event_at TEXT NOT NULL)`)
    const store = createActivityStore(database)
    store.recordEvent({ sessionId: 's1', provider: 'claude', repository: null, branch: null, title: 'Old database', folder: 'dashi', state: 'idle', occurredAt: at(0) })
    expect(store.readSessions()[0]).toMatchObject({ title: 'Old database', folder: 'dashi' })
  })

  it('keeps which machine reported each sample, its account and launch, and adds those columns to an older database', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`CREATE TABLE token_usage_samples (session_id TEXT NOT NULL, model TEXT NOT NULL, token_type TEXT NOT NULL,
      tokens INTEGER NOT NULL, recorded_at TEXT NOT NULL)`)
    database.exec(`INSERT INTO token_usage_samples VALUES ('s0', 'claude-opus-5-5', 'input', 5, '${at(0)}')`)
    const store = createActivityStore(database)
    store.recordTokenUsage([{ ...point(7, false), account: 'me@example.com', launchHint: 'cli' }], 'machine-1')
    expect(store.readTokenSamplesSince(at(0))).toEqual([
      expect.objectContaining({ sessionId: 's0', machineTokenId: null, account: null, launchHint: null }),
      expect.objectContaining({ tokens: 7, machineTokenId: 'machine-1', account: 'me@example.com', launchHint: 'cli' }),
    ])
  })
})

describe('usage by source', () => {
  const session = (sessionId: string, overrides: Partial<StoredSession> = {}): StoredSession => ({
    sessionId,
    provider: 'claude',
    repository: { owner: 'cnotv', name: 'dashi' },
    branch: null,
    title: null,
    folder: 'dashi',
    state: 'idle',
    startedAt: at(0),
    lastEventAt: at(10),
    ...overrides,
  })
  const sample = (sessionId: string, tokens: number, overrides: Partial<StoredTokenSample> = {}): StoredTokenSample => ({
    sessionId,
    model: 'claude-opus-5-5',
    tokenType: 'output',
    tokens,
    recordedAt: at(5),
    machineTokenId: 'laptop-token',
    account: 'me@example.com',
    launchHint: null,
    ...overrides,
  })
  const laptopStartId = '0123abcd-0000-4000-8000-000000000000'
  const cloudStartId = 'fedc0000-0000-4000-8000-000000000000'
  const starts = [
    { startId: laptopStartId, repository: { owner: 'cnotv', name: 'dashi' }, target: 'laptop-headless' as const, sessionUrl: null },
    { startId: cloudStartId, repository: { owner: 'cnotv', name: 'dashi' }, target: 'cloud-routine' as const, sessionUrl: 'https://claude.ai/code/session_01Routine' },
  ]
  const reportOf = (sessions: StoredSession[], samples: StoredTokenSample[]) =>
    buildUsageReport(sessions, samples, () => null, at(0), atMilliseconds(30), {
      machineLabelOf: (tokenId) => (tokenId === 'laptop-token' ? 'Laptop' : null),
      starts,
    })
  const rowsOf = (rows: Array<{ label: string; sessionCount: number; tokens: { total: number }; note: string | null }>) =>
    rows.map((row) => [row.label, row.sessionCount, row.tokens.total, row.note])

  it('splits tokens by the machine that reported them, naming a removed or unknown one', () => {
    const report = reportOf(
      [session('a'), session('b'), session('c')],
      [sample('a', 50), sample('b', 30, { machineTokenId: 'revoked-token' }), sample('c', 20, { machineTokenId: null })],
    )
    expect(rowsOf(report.byMachine)).toEqual([
      ['Laptop', 1, 50, null],
      ['Removed machine', 1, 30, null],
      ['Unknown machine', 1, 20, null],
    ])
  })

  it('splits tokens by account, naming an organization and a session with no signed-in account', () => {
    const report = reportOf(
      [session('a'), session('b'), session('c')],
      [sample('a', 50), sample('b', 30, { account: 'org:0f1e2d3c-aaaa' }), sample('c', 20, { account: null })],
    )
    expect(rowsOf(report.byAccount)).toEqual([
      ['me@example.com', 1, 50, null],
      ['Organization 0f1e2d3c', 1, 30, null],
      ['No signed-in account', 1, 20, 'API key, Bedrock or Vertex'],
    ])
  })

  it('tells board starts, cloud sessions and hand-started ones apart', () => {
    const report = reportOf(
      [
        session('laptop', { folder: startFolderNameOf('dashi', laptopStartId) }),
        session('routine'),
        session('cloud'),
        session('terminal'),
        session('ide'),
        session('silent'),
      ],
      [
        sample('laptop', 60, { launchHint: 'cli' }),
        sample('routine', 50, { launchHint: 'cloud:cse_01Routine' }),
        sample('cloud', 40, { launchHint: 'cloud:cse_01Other' }),
        sample('terminal', 30, { launchHint: 'cli' }),
        sample('ide', 20, { launchHint: 'claude-vscode' }),
        sample('silent', 10),
      ],
    )
    expect(rowsOf(report.byLaunch)).toEqual([
      ['Board, laptop runner', 1, 60, null],
      ['Board, Claude cloud', 1, 50, null],
      ['Claude cloud', 1, 40, null],
      ['Terminal', 1, 30, null],
      ['VS Code', 1, 20, null],
      ['Not reported', 1, 10, 'Reconnect the machine with dashi connect'],
    ])
  })

  it('lists Codex sessions in the period with no tokens, since Codex sends no token metrics', () => {
    const report = reportOf([session('a'), session('codex', { provider: 'codex' })], [sample('a', 50)])
    expect(rowsOf(report.byAgent)).toEqual([
      ['Claude Code', 1, 50, null],
      ['Codex', 1, 0, 'No token metrics'],
    ])
  })

  it("names a start's folder the way the runner does", () => {
    expect(startFolderNameOf('generative-art', laptopStartId)).toBe(startFolderNameFor('generative-art', laptopStartId))
  })
})

describe('timeline and states', () => {
  it('draws a segment per state until the next event, and nothing after an end', () => {
    const events = [
      { sessionId: 's1', state: 'working' as const, occurredAt: at(0) },
      { sessionId: 's1', state: 'waiting' as const, occurredAt: at(10) },
      { sessionId: 's1', state: 'ended' as const, occurredAt: at(20) },
      { sessionId: 's2', state: 'working' as const, occurredAt: at(15) },
    ]
    expect(buildTimeline(events, at(5), atMilliseconds(30))).toEqual([
      { sessionId: 's1', state: 'working', startedAt: at(5), endedAt: at(10) },
      { sessionId: 's1', state: 'waiting', startedAt: at(10), endedAt: at(20) },
      { sessionId: 's2', state: 'working', startedAt: at(15), endedAt: at(30) },
    ])
  })

  it('calls a silent session inactive', () => {
    const session: StoredSession = {
      sessionId: 's1',
      provider: 'claude',
      repository: null,
      branch: null,
      title: null,
      folder: null,
      state: 'working',
      startedAt: at(0),
      lastEventAt: at(0),
    }
    expect(effectiveState(session, atMilliseconds(0) + inactiveAfterMilliseconds - 1)).toBe('working')
    expect(effectiveState(session, atMilliseconds(0) + inactiveAfterMilliseconds + 1)).toBe('inactive')
    expect(effectiveState({ ...session, state: 'ended' }, atMilliseconds(0) + inactiveAfterMilliseconds + 1)).toBe('ended')
  })
})

describe('ingest and read routes', () => {
  const hookHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    'x-agent-provider': 'claude',
    'x-agent-branch': 'feat/12-sessions',
    'x-agent-remote': 'https://github.com/cnotv/generative-art.git',
  })

  const setUp = () => {
    const clock = { now: atMilliseconds(30) }
    const testApp = createTestApp({}, {}, clock)
    const { token } = testApp.ingestTokens.createToken('laptop')
    return { ...testApp, clock, token }
  }

  it('refuses events and metrics without a valid ingest token', async () => {
    const { app } = setUp()
    const event = { session_id: 's1', hook_event_name: 'Stop' }
    expect((await app.request(jsonRequest('POST', '/api/events', event))).status).toBe(401)
    expect((await app.request(jsonRequest('POST', '/api/events', event, { authorization: 'Bearer adt_wrong' }))).status).toBe(401)
    expect((await app.request(jsonRequest('POST', '/api/telemetry/v1/metrics', tokenMetrics('s1', []), {}))).status).toBe(401)
  })

  it('records events and usage and reports them per session, repository and branch', async () => {
    const { app, token, clock } = setUp()
    await app.request(jsonRequest('POST', '/api/events', { session_id: 's1', hook_event_name: 'UserPromptSubmit' }, hookHeaders(token)))
    const metricsResponse = await app.request(
      jsonRequest('POST', '/api/telemetry/v1/metrics', tokenMetrics('s1', [{ type: 'input', value: 900 }, { type: 'output', value: 100 }]), {
        authorization: `Bearer ${token}`,
      }),
    )
    expect(metricsResponse.status).toBe(200)
    clock.now += 5 * 60_000

    const overview: unknown = await (await app.request(getRequest('/api/sessions'))).json()
    expect(overview).toEqual(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            sessionId: 's1',
            state: 'working',
            repository: { owner: 'cnotv', name: 'generative-art' },
            issueNumber: 12,
            tokens: { input: 900, output: 100, cacheRead: 0, cacheCreation: 0, total: 1000 },
          }),
        ],
        timeline: [expect.objectContaining({ sessionId: 's1', state: 'working' })],
      }),
    )

    const usage: unknown = await (await app.request(getRequest('/api/usage'))).json()
    expect(usage).toEqual(
      expect.objectContaining({
        generatedAt: new Date(clock.now).toISOString(),
        totals: expect.objectContaining({ total: 1000 }),
        byRepository: [expect.objectContaining({ repository: { owner: 'cnotv', name: 'generative-art' }, sessionCount: 1 })],
        byWork: [expect.objectContaining({ branch: 'feat/12-sessions', issueNumber: 12, pullRequestNumber: null })],
        byMachine: [expect.objectContaining({ label: 'laptop', sessionCount: 1 })],
      }),
    )
  })

  it('accepts ingest with a token when sign-in is required, and keeps reading behind sign-in', async () => {
    const clock = { now: atMilliseconds(30) }
    const { app, ingestTokens } = createTestApp({}, { signInRequired: true }, clock)
    const { token } = ingestTokens.createToken('server')
    const eventResponse = await app.request(
      jsonRequest('POST', '/api/events', { session_id: 's1', hook_event_name: 'Stop' }, { authorization: `Bearer ${token}` }),
    )
    expect(eventResponse.status).toBe(204)
    expect((await app.request(getRequest('/api/sessions'))).status).toBe(401)
    expect((await app.request(getRequest('/api/usage'))).status).toBe(401)
    expect((await app.request(getRequest('/api/ingest-tokens'))).status).toBe(401)
  })

  it('shows a new token once and stores only its hash', async () => {
    const { app, database } = setUp()
    const created = createdTokenSchema.parse(await (await app.request(jsonRequest('POST', '/api/ingest-tokens', { label: 'desktop' }))).json())
    expect(created.token).toMatch(/^adt_/)
    const listed = await (await app.request(getRequest('/api/ingest-tokens'))).text()
    expect(listed).not.toContain(created.token)
    const storedRows = JSON.stringify(database.prepare('SELECT * FROM ingest_tokens').all())
    expect(storedRows).not.toContain(created.token)

    expect((await app.request(jsonRequest('DELETE', `/api/ingest-tokens/${created.summary.tokenId}`, {}))).status).toBe(204)
    const refused = await app.request(
      jsonRequest('POST', '/api/events', { session_id: 's1', hook_event_name: 'Stop' }, { authorization: `Bearer ${created.token}` }),
    )
    expect(refused.status).toBe(401)
  })

  it('refuses an oversized event body', async () => {
    const { app, token } = setUp()
    const response = await app.request(
      jsonRequest('POST', '/api/events', { session_id: 's1', hook_event_name: 'Stop', padding: 'x'.repeat(70 * 1024) }, { authorization: `Bearer ${token}` }),
    )
    expect(response.status).toBe(413)
  })
})
