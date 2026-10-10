import { describe, expect, it } from 'vitest'
import { emptyTracker, outcomeOfEvent, outcomeOfPrompt, parseReporterSettings, reporterSettingsPathFor, tokenMetricName } from './opencode-reporter.ts'
import type { ReportTracker } from './opencode-reporter.ts'

const sessionInfo = (id: string, extra: Record<string, unknown> = {}) => ({ id, directory: '/Users/me/dashi/worktrees/marbles-0123abcd', title: 'New session', ...extra })
const created = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'session.created', properties: { info: sessionInfo(id, extra) } })
const answer = (id: string, sessionID: string, tokens: Record<string, unknown>, completed = 1_790_000_000_000) => ({
  type: 'message.updated',
  properties: {
    info: { id, sessionID, role: 'assistant', providerID: 'openrouter', modelID: 'openai/gpt-5-mini', time: { created: 1, completed }, tokens },
  },
})

const replay = (events: unknown[], tracker: ReportTracker = emptyTracker()) =>
  events.reduce<{ tracker: ReportTracker; outcomes: ReturnType<typeof outcomeOfEvent>[] }>(
    (state, event) => {
      const outcome = outcomeOfEvent(state.tracker, event)
      return { tracker: outcome.tracker, outcomes: [...state.outcomes, outcome] }
    },
    { tracker, outcomes: [] },
  )

describe('outcomeOfEvent', () => {
  it('reports a session from creation through work, a permission and its end', () => {
    const { outcomes } = replay([
      created('ses_1'),
      { type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } },
      { type: 'permission.asked', properties: { id: 'per_1', sessionID: 'ses_1', type: 'bash', title: 'rm -rf build' } },
      { type: 'permission.updated', properties: { id: 'per_2', sessionID: 'ses_1' } },
      { type: 'permission.replied', properties: { sessionID: 'ses_1', permissionID: 'per_1', response: 'once' } },
      { type: 'session.idle', properties: { sessionID: 'ses_1' } },
      { type: 'session.deleted', properties: { info: sessionInfo('ses_1') } },
    ])
    expect(outcomes.map((outcome) => outcome.sessionReport)).toEqual([
      { type: 'session.created', session_id: 'ses_1', cwd: '/Users/me/dashi/worktrees/marbles-0123abcd' },
      { type: 'session.status', session_id: 'ses_1', status: 'busy' },
      { type: 'permission.asked', session_id: 'ses_1' },
      { type: 'permission.asked', session_id: 'ses_1' },
      { type: 'permission.replied', session_id: 'ses_1' },
      { type: 'session.idle', session_id: 'ses_1' },
      { type: 'session.deleted', session_id: 'ses_1' },
    ])
  })

  it("never sends the permission's title, and ignores events it does not know or cannot read", () => {
    const { outcomes } = replay([
      { type: 'permission.asked', properties: { sessionID: 'ses_1', title: 'cat ~/.ssh/id_rsa' } },
      { type: 'file.edited', properties: { file: 'a.ts' } },
      { type: 'session.status', properties: { sessionID: 'ses_1' } },
      { type: 'session.created', properties: { info: { directory: '/x' } } },
      null,
      'session.idle',
    ])
    expect(JSON.stringify(outcomes)).not.toContain('id_rsa')
    expect(outcomes.slice(1).every((outcome) => outcome.sessionReport === null && outcome.tokenReport === null)).toBe(true)
  })

  it("keeps a subagent's session out of Sessions and counts its tokens toward the session that started it", () => {
    const { outcomes } = replay([
      created('ses_1'),
      created('ses_child', { parentID: 'ses_1' }),
      created('ses_grandchild', { parentID: 'ses_child' }),
      { type: 'session.status', properties: { sessionID: 'ses_child', status: { type: 'busy' } } },
      answer('msg_1', 'ses_grandchild', { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }),
    ])
    expect(outcomes.slice(1, 4).map((outcome) => outcome.sessionReport)).toEqual([null, null, null])
    const point = outcomes[4]?.tokenReport?.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.sum.dataPoints[0]
    expect(point?.attributes).toContainEqual({ key: 'session.id', value: { stringValue: 'ses_1' } })
  })

  it("reports a finished answer's tokens once, as deltas, with reasoning counted as output", () => {
    const tokens = { input: 1200, output: 300, reasoning: 50, cache: { read: 4000, write: 0 } }
    const { outcomes } = replay([answer('msg_1', 'ses_1', tokens, 0), answer('msg_1', 'ses_1', tokens), answer('msg_1', 'ses_1', tokens)])
    expect(outcomes[0]?.tokenReport).toBeNull()
    expect(outcomes[2]?.tokenReport).toBeNull()
    const metric = outcomes[1]?.tokenReport?.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]
    expect(metric).toMatchObject({ name: tokenMetricName, sum: { aggregationTemporality: 1 } })
    expect(
      metric?.sum.dataPoints.map((point) => [point.attributes.find((attribute) => attribute.key === 'type')?.value.stringValue, point.asInt]),
    ).toEqual([
      ['input', '1200'],
      ['output', '350'],
      ['cacheRead', '4000'],
    ])
    expect(metric?.sum.dataPoints[0]?.attributes).toContainEqual({ key: 'model', value: { stringValue: 'openrouter/openai/gpt-5-mini' } })
  })
})

describe('outcomeOfPrompt', () => {
  it("names a session by its first prompt's first line only, and sends no later prompt", () => {
    const first = outcomeOfPrompt(emptyTracker(), 'ses_1', [
      { type: 'file', url: 'file:///a.png' },
      { type: 'text', text: '\n  Fix the marbles\nThey stick to the ramp; my token is sk-secret' },
    ])
    expect(first.sessionReport).toEqual({ type: 'chat.message', session_id: 'ses_1', prompt: 'Fix the marbles' })
    const second = outcomeOfPrompt(first.tracker, 'ses_1', [{ type: 'text', text: 'Also the docs' }])
    expect(second.sessionReport).toEqual({ type: 'chat.message', session_id: 'ses_1' })
    expect(outcomeOfPrompt(emptyTracker(), 'ses_1', [{ type: 'text', text: 'x'.repeat(500) }]).sessionReport?.prompt).toHaveLength(200)
  })

  it("says nothing about a subagent's prompts", () => {
    const { tracker } = outcomeOfEvent(emptyTracker(), created('ses_child', { parentID: 'ses_1' }))
    expect(outcomeOfPrompt(tracker, 'ses_child', [{ type: 'text', text: 'Search the code' }]).sessionReport).toBeNull()
  })
})

describe('parseReporterSettings', () => {
  it('needs an https dashboard, or one on this machine, and a token', () => {
    expect(parseReporterSettings(JSON.stringify({ dashboardUrl: 'https://dash.example.com/', ingestToken: 'adi_x' }))).toEqual({
      dashboardUrl: 'https://dash.example.com',
      ingestToken: 'adi_x',
    })
    expect(parseReporterSettings(JSON.stringify({ dashboardUrl: 'http://localhost:4317', ingestToken: 'adi_x' }))?.dashboardUrl).toBe('http://localhost:4317')
    expect(parseReporterSettings(JSON.stringify({ dashboardUrl: 'http://dash.example.com', ingestToken: 'adi_x' }))).toBeNull()
    expect(parseReporterSettings(JSON.stringify({ dashboardUrl: 'https://dash.example.com' }))).toBeNull()
    expect(parseReporterSettings('not json')).toBeNull()
  })

  it('reads its config from ~/dashi unless DASHI_HOME moves it', () => {
    expect(reporterSettingsPathFor({ DASHI_HOME: '/srv/dashi' })).toBe('/srv/dashi/opencode.json')
    expect(reporterSettingsPathFor({}).endsWith('/dashi/opencode.json')).toBe(true)
  })
})
