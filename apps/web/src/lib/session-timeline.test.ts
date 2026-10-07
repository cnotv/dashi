import { describe, expect, it } from 'vitest'
import type { AgentSessionSummary, SessionsOverview } from '@dashi/contracts'
import { buildTimeTicks, layoutSessionTimeline, sessionLabel, sessionOriginLine } from './session-timeline'

const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }

const sessionWith = (overrides: Partial<AgentSessionSummary>): AgentSessionSummary => ({
  sessionId: 'session-one',
  provider: 'claude',
  repository: { owner: 'cnotv', name: 'example' },
  branch: 'feat/4-thing',
  title: null,
  folder: null,
  issueNumber: 4,
  state: 'working',
  startedAt: '2026-09-29T00:00:00.000Z',
  lastEventAt: '2026-09-29T09:00:00.000Z',
  tokens: zeroTokens,
  triggeredBy: 'Not reported',
  billedThrough: 'Not reported',
  ...overrides,
})

const overviewWith = (overrides: Partial<SessionsOverview>): SessionsOverview => ({
  sessions: [sessionWith({})],
  timeline: [],
  windowStartedAt: '2026-09-29T00:00:00.000Z',
  generatedAt: '2026-09-29T10:00:00.000Z',
  ...overrides,
})

const formatAsHour = (isoTime: string): string => isoTime.slice(11, 16)

describe('layoutSessionTimeline', () => {
  it('places each stretch as a share of the window', () => {
    const { lanes } = layoutSessionTimeline(
      overviewWith({
        timeline: [
          { sessionId: 'session-one', state: 'idle', startedAt: '2026-09-29T01:00:00.000Z', endedAt: '2026-09-29T02:00:00.000Z' },
          { sessionId: 'session-one', state: 'working', startedAt: '2026-09-29T02:00:00.000Z', endedAt: '2026-09-29T10:00:00.000Z' },
        ],
      }),
      formatAsHour,
    )
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.bars.map((bar) => [bar.state, bar.leftPercent, bar.widthPercent])).toEqual([
      ['idle', 10, 10],
      ['working', 20, 80],
    ])
  })

  it('charts only sessions that are still running', () => {
    const { lanes } = layoutSessionTimeline(
      overviewWith({
        sessions: [
          sessionWith({ sessionId: 'running' }),
          sessionWith({ sessionId: 'finished', state: 'ended' }),
          sessionWith({ sessionId: 'silent', state: 'inactive' }),
        ],
      }),
      formatAsHour,
    )
    expect(lanes.map((lane) => lane.sessionId)).toEqual(['running'])
  })

  it('clamps a stretch to the window', () => {
    const { lanes } = layoutSessionTimeline(
      overviewWith({
        timeline: [{ sessionId: 'session-one', state: 'waiting', startedAt: '2026-09-28T20:00:00.000Z', endedAt: '2026-09-29T05:00:00.000Z' }],
      }),
      formatAsHour,
    )
    expect(lanes[0]?.bars[0]).toMatchObject({ leftPercent: 0, widthPercent: 50 })
  })
})

describe('buildTimeTicks', () => {
  it('keeps a day to a handful of whole-hour labels', () => {
    const ticks = buildTimeTicks('2026-09-28T10:30:00.000Z', '2026-09-29T10:30:00.000Z', formatAsHour)
    expect(ticks.map((tick) => tick.label)).toEqual(['12:00', '18:00', '00:00', '06:00'])
  })

  it('uses hourly ticks for a short window', () => {
    const ticks = buildTimeTicks('2026-09-29T04:00:00.000Z', '2026-09-29T10:00:00.000Z', formatAsHour)
    expect(ticks).toHaveLength(7)
    expect(ticks[0]).toMatchObject({ label: '04:00', leftPercent: 0 })
    expect(ticks.at(-1)).toMatchObject({ label: '10:00', leftPercent: 100 })
  })
})

describe('sessionLabel', () => {
  it('names a session by its repository, or by its id when it has none', () => {
    expect(sessionLabel(sessionWith({}))).toBe('example')
    expect(sessionLabel(sessionWith({ repository: null, sessionId: 'abcdef1234567' }))).toBe('Session abcdef12')
  })
})

describe('sessionOriginLine', () => {
  it('says what started a session and what paid for it, leaving out what was not reported', () => {
    expect(sessionOriginLine(sessionWith({ triggeredBy: 'CodePilot', billedThrough: 'Anthropic API key' }))).toBe(
      'via CodePilot · Anthropic API key',
    )
    expect(sessionOriginLine(sessionWith({ triggeredBy: 'Terminal (iTerm)' }))).toBe('via Terminal (iTerm)')
    expect(sessionOriginLine(sessionWith({ billedThrough: 'OpenRouter' }))).toBe('paid through OpenRouter')
    expect(sessionOriginLine(sessionWith({}))).toBeNull()
  })
})
