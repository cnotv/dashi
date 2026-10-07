import type { AgentSessionState, AgentSessionSummary, SessionsOverview } from '@dashi/contracts'
import type { ChartedSessionState, SessionTimelineLayout, TimeTick, TimelineLane } from './types'

const hourMilliseconds = 60 * 60_000
const tickStepHours = [1, 2, 3, 6, 12, 24]
const maximumTickCount = 6
const chartedStates: ChartedSessionState[] = ['working', 'waiting', 'idle']

export const sessionStateOrder: Record<AgentSessionState, number> = { working: 0, waiting: 1, idle: 2, inactive: 3, ended: 4 }

/**
 * Tells whether a state is one the timeline draws: working, waiting or idle.
 * @param state The session state.
 * @returns True for a charted state.
 */
export const isChartedState = (state: AgentSessionState): state is ChartedSessionState =>
  chartedStates.some((chartedState) => chartedState === state)

/**
 * Tells whether a session is still running.
 * @param session The session.
 * @returns True when it is working, waiting or idle.
 */
export const isOngoing = (session: AgentSessionSummary): boolean => isChartedState(session.state)

const shortSessionId = (sessionId: string): string => sessionId.slice(0, 8)

/**
 * Names a session by what it was asked first, then by its repository or folder, then by its short id.
 * @param session The session.
 * @returns The label.
 */
export const sessionLabel = (session: AgentSessionSummary): string =>
  session.title ?? session.repository?.name ?? session.folder ?? `Session ${shortSessionId(session.sessionId)}`

/**
 * The second line under a session's name: where it works and on which branch, or its short id.
 * @param session The session.
 * @returns The detail.
 */
export const sessionDetail = (session: AgentSessionSummary): string => {
  const place = session.repository === null ? session.folder : `${session.repository.owner}/${session.repository.name}`
  const parts = [place, session.branch].filter((part) => part !== null)
  return parts.length === 0 ? shortSessionId(session.sessionId) : parts.join(' · ')
}

const notReported = 'Not reported'

/**
 * Says what started a session and what paid for it, for the line under its name.
 * @param session The session.
 * @returns Such as "via CodePilot · Anthropic API key", or null when neither was reported.
 */
export const sessionOriginLine = (session: AgentSessionSummary): string | null => {
  const trigger = session.triggeredBy === notReported ? null : session.triggeredBy
  const billing = session.billedThrough === notReported ? null : session.billedThrough
  if (trigger === null) return billing === null ? null : `paid through ${billing}`
  return billing === null ? `via ${trigger}` : `via ${trigger} · ${billing}`
}

const percentOf = (milliseconds: number, windowStart: number, windowLength: number): number =>
  Math.min(100, Math.max(0, ((milliseconds - windowStart) / windowLength) * 100))

/**
 * Places whole-hour ticks along the timeline's axis.
 * The step is the smallest one that keeps the axis to a handful of labels, and every tick sits
 * on a whole hour so the labels read as clock times.
 * @param windowStartedAt Where the axis starts.
 * @param generatedAt Where it ends, which is now.
 * @param formatTime Writes a tick's time; injected so tests do not depend on the time zone.
 * @returns The ticks, each with its position as a percentage.
 */
export const buildTimeTicks = (
  windowStartedAt: string,
  generatedAt: string,
  formatTime: (isoTime: string) => string,
): TimeTick[] => {
  const windowStart = Date.parse(windowStartedAt)
  const windowEnd = Date.parse(generatedAt)
  const windowLength = Math.max(1, windowEnd - windowStart)
  const stepHours = tickStepHours.find((hours) => windowLength / (hours * hourMilliseconds) <= maximumTickCount) ?? 24
  const stepMilliseconds = stepHours * hourMilliseconds
  const firstTick = Math.ceil(windowStart / stepMilliseconds) * stepMilliseconds
  const tickCount = Math.max(0, Math.floor((windowEnd - firstTick) / stepMilliseconds) + 1)
  return Array.from({ length: tickCount }, (_, tickIndex) => {
    const tickTime = new Date(firstTick + tickIndex * stepMilliseconds).toISOString()
    return { tickKey: tickTime, label: formatTime(tickTime), leftPercent: percentOf(Date.parse(tickTime), windowStart, windowLength) }
  })
}

/**
 * Lays out the timeline: one lane per running session, each stretch placed as a share of the window.
 * @param overview The sessions overview from the server.
 * @param formatTime Writes a tick's time.
 * @returns The lanes and the axis ticks.
 */
export const layoutSessionTimeline = (
  overview: SessionsOverview,
  formatTime: (isoTime: string) => string,
): SessionTimelineLayout => {
  const windowStart = Date.parse(overview.windowStartedAt)
  const windowLength = Math.max(1, Date.parse(overview.generatedAt) - windowStart)
  const lanes = overview.sessions.filter(isOngoing).map(
    (session): TimelineLane => ({
      sessionId: session.sessionId,
      state: session.state,
      bars: overview.timeline
        .filter((segment) => segment.sessionId === session.sessionId)
        .flatMap((segment) => {
          if (!isChartedState(segment.state)) return []
          const leftPercent = percentOf(Date.parse(segment.startedAt), windowStart, windowLength)
          const widthPercent = percentOf(Date.parse(segment.endedAt), windowStart, windowLength) - leftPercent
          return widthPercent > 0
            ? [{ barKey: segment.startedAt, state: segment.state, startedAt: segment.startedAt, endedAt: segment.endedAt, leftPercent, widthPercent }]
            : []
        }),
    }),
  )
  return { lanes, ticks: buildTimeTicks(overview.windowStartedAt, overview.generatedAt, formatTime) }
}
