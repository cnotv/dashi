import type {
  AgentProvider,
  AgentSessionState,
  AgentSessionSummary,
  RepositoryReference,
  SessionTimelineSegment,
  SessionsOverview,
  TokenTotals,
  UsageByDay,
  UsageByModel,
  UsageByRepository,
  UsageBySource,
  UsageByWork,
  UsageReport,
} from '@dashi/contracts'
import { issueNumberFromBranch } from '../github/status.ts'
import { agentProviderOf } from './ingest.ts'
import { billingLabelOf, originNoteOf, triggerLabelerFor } from './origin.ts'
import type { StoredEvent, StoredSession, StoredTokenSample, UsageSourceLookups } from './types.ts'

// A session that has said nothing for this long is not running any more, even though it never
// sent SessionEnd: a closed laptop or a killed terminal never does.
export const inactiveAfterMilliseconds = 6 * 60 * 60_000

/**
 * Starts a token count at zero for every type.
 * @returns Totals of zero.
 */
export const emptyTokenTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 })

/**
 * Adds up token samples by type.
 * @param samples The samples to add up.
 * @returns The totals per type and overall.
 */
export const sumTokens = (samples: StoredTokenSample[]): TokenTotals =>
  samples.reduce(
    (totals, sample) => ({ ...totals, [sample.tokenType]: totals[sample.tokenType] + sample.tokens, total: totals.total + sample.tokens }),
    emptyTokenTotals(),
  )

/**
 * Tells what a session is doing now, counting one that has been silent too long as inactive.
 * @param session The stored session.
 * @param now The current time in milliseconds.
 * @returns The state to show.
 */
export const effectiveState = (session: StoredSession, now: number): AgentSessionState =>
  session.state !== 'ended' && now - Date.parse(session.lastEventAt) > inactiveAfterMilliseconds ? 'inactive' : session.state

const groupBy = <Item>(items: Item[], keyOf: (item: Item) => string): Map<string, Item[]> =>
  items.reduce((groups, item) => groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]), new Map<string, Item[]>())

const latest = (first: string, second: string): string => (first > second ? first : second)
const earliest = (first: string, second: string): string => (first < second ? first : second)

/**
 * Turns session events into stretches of working, waiting and idle for the timeline chart.
 * Each event starts a stretch of its state that lasts until the next event. The last one runs
 * until now, or until the session is taken for inactive; an ended session draws nothing after it.
 * @param events The events inside the window, oldest first.
 * @param windowStartedAt Where the chart starts; stretches are clipped to it.
 * @param now The current time in milliseconds.
 * @returns One segment per stretch.
 */
export const buildTimeline = (events: StoredEvent[], windowStartedAt: string, now: number): SessionTimelineSegment[] =>
  [...groupBy(events, (event) => event.sessionId).values()].flatMap((sessionEvents) =>
    sessionEvents
      .map((event, index): SessionTimelineSegment | null => {
        if (event.state === 'ended') return null
        const nextEvent = sessionEvents[index + 1]
        const openEnd = new Date(Math.min(now, Date.parse(event.occurredAt) + inactiveAfterMilliseconds)).toISOString()
        const endedAt = nextEvent === undefined ? openEnd : earliest(nextEvent.occurredAt, openEnd)
        const startedAt = latest(event.occurredAt, windowStartedAt)
        return endedAt > startedAt ? { sessionId: event.sessionId, state: event.state, startedAt, endedAt } : null
      })
      .filter((segment): segment is SessionTimelineSegment => segment !== null),
  )

const stateOrder: Record<AgentSessionState, number> = { working: 0, waiting: 1, idle: 2, inactive: 3, ended: 4 }

/**
 * Builds the Sessions page: each session active in the window, with its state and tokens, and the timeline.
 * @param sessions Every stored session.
 * @param events The events inside the window.
 * @param samples The token samples inside the window.
 * @param windowStartedAt Where the window starts.
 * @param now The current time in milliseconds.
 * @param lookups The board starts, to tell the sessions the board started.
 * @returns The sessions, running ones first, and the timeline.
 */
export const buildSessionsOverview = (
  sessions: StoredSession[],
  events: StoredEvent[],
  samples: StoredTokenSample[],
  windowStartedAt: string,
  now: number,
  lookups: Pick<UsageSourceLookups, 'starts'>,
): SessionsOverview => {
  const samplesBySession = groupBy(samples, (sample) => sample.sessionId)
  const triggerOf = triggerLabelerFor(lookups.starts)
  const summaries = sessions
    .filter((session) => session.lastEventAt >= windowStartedAt)
    .map(
      (session): AgentSessionSummary => ({
        sessionId: session.sessionId,
        provider: session.provider,
        repository: session.repository,
        branch: session.branch,
        title: session.title,
        folder: session.folder,
        issueNumber: session.branch === null ? null : issueNumberFromBranch(session.branch),
        state: effectiveState(session, now),
        startedAt: session.startedAt,
        lastEventAt: session.lastEventAt,
        tokens: sumTokens(samplesBySession.get(session.sessionId) ?? []),
        triggeredBy: triggerOf(session, samplesBySession.get(session.sessionId)?.[0]?.launchHint ?? null),
        billedThrough: billingLabelOf(session, samplesBySession.get(session.sessionId)?.[0]),
      }),
    )
    .sort((first, second) => stateOrder[first.state] - stateOrder[second.state] || (first.lastEventAt < second.lastEventAt ? 1 : -1))
  return {
    sessions: summaries,
    timeline: buildTimeline(events, windowStartedAt, now),
    windowStartedAt,
    generatedAt: new Date(now).toISOString(),
  }
}

const repositoryKey = (repository: RepositoryReference | null): string =>
  repository === null ? '' : `${repository.owner}/${repository.name}`

const byTotalDescending = <Row extends { tokens: TokenTotals }>(first: Row, second: Row): number =>
  second.tokens.total - first.tokens.total

export type PullRequestFinder = (repository: RepositoryReference, branch: string) => number | null

const sourceRows = (
  samples: StoredTokenSample[],
  keyOf: (sample: StoredTokenSample) => string,
  describeSource: (sourceKey: string) => Pick<UsageBySource, 'label' | 'note'>,
): UsageBySource[] =>
  [...groupBy(samples, keyOf).entries()]
    .map(
      ([sourceKey, group]): UsageBySource => ({
        sourceKey,
        ...describeSource(sourceKey),
        sessionCount: new Set(group.map((sample) => sample.sessionId)).size,
        tokens: sumTokens(group),
      }),
    )
    .sort(byTotalDescending)

// The distinct labels of a group, the one that spent the most tokens first.
const labelsByTokens = (group: StoredTokenSample[], labelOf: (sample: StoredTokenSample) => string): string[] =>
  [...groupBy(group, labelOf).entries()]
    .map(([label, labelled]) => ({ label, total: sumTokens(labelled).total }))
    .sort((first, second) => second.total - first.total)
    .map(({ label }) => label)

const machineRowOf =
  (machineLabelOf: UsageSourceLookups['machineLabelOf']) =>
  (machineTokenId: string): Pick<UsageBySource, 'label' | 'note'> => ({
    label: machineTokenId === '' ? 'Unknown machine' : (machineLabelOf(machineTokenId) ?? 'Removed machine'),
    note: null,
  })

const agentLabels: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

/**
 * Adds up token usage for all repositories, then by repository, by pull request or branch, by day and by model.
 * @param sessions Every stored session, to place each sample.
 * @param samples The token samples inside the period.
 * @param findPullRequest Finds the open pull request of a branch.
 * @param windowStartedAt Where the period starts.
 * @param now The current time in milliseconds.
 * @param lookups The machine labels and board starts that name where tokens were spent.
 * @returns The usage report.
 */
export const buildUsageReport = (
  sessions: StoredSession[],
  samples: StoredTokenSample[],
  findPullRequest: PullRequestFinder,
  windowStartedAt: string,
  now: number,
  lookups: UsageSourceLookups,
): UsageReport => {
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]))
  const sessionOf = (sample: StoredTokenSample): StoredSession | undefined => sessionsById.get(sample.sessionId)
  const distinctSessions = (group: StoredTokenSample[]): number => new Set(group.map((sample) => sample.sessionId)).size
  const firstSessionOf = (group: StoredTokenSample[]): StoredSession | undefined =>
    group[0] === undefined ? undefined : sessionOf(group[0])

  const triggerOf = triggerLabelerFor(lookups.starts)
  const triggerOfSample = (sample: StoredTokenSample): string => triggerOf(sessionOf(sample), sample.launchHint)
  const billingOfSample = (sample: StoredTokenSample): string => billingLabelOf(sessionOf(sample), sample)

  const byRepository = [...groupBy(samples, (sample) => repositoryKey(sessionOf(sample)?.repository ?? null)).values()]
    .map(
      (group): UsageByRepository => ({
        repository: firstSessionOf(group)?.repository ?? null,
        tokens: sumTokens(group),
        sessionCount: distinctSessions(group),
      }),
    )
    .sort(byTotalDescending)

  const workKey = (sample: StoredTokenSample): string => {
    const session = sessionOf(sample)
    return `${repositoryKey(session?.repository ?? null)}#${session?.branch ?? ''}`
  }
  const byWork = [...groupBy(samples, workKey).values()]
    .map((group): UsageByWork => {
      const session = firstSessionOf(group)
      const repository = session?.repository ?? null
      const branch = session?.branch ?? null
      return {
        repository,
        branch,
        issueNumber: branch === null ? null : issueNumberFromBranch(branch),
        pullRequestNumber: repository === null || branch === null ? null : findPullRequest(repository, branch),
        triggeredBy: labelsByTokens(group, triggerOfSample),
        billedThrough: labelsByTokens(group, billingOfSample),
        tokens: sumTokens(group),
        sessionCount: distinctSessions(group),
      }
    })
    .sort(byTotalDescending)

  const byDay = [...groupBy(samples, (sample) => sample.recordedAt.slice(0, 10)).entries()]
    .map(([day, group]): UsageByDay => ({ day, tokens: sumTokens(group) }))
    .sort((first, second) => (first.day < second.day ? -1 : 1))

  const byModel = [...groupBy(samples, (sample) => sample.model).entries()]
    .map(([model, group]): UsageByModel => ({ model, tokens: sumTokens(group) }))
    .sort(byTotalDescending)

  // Codex sends no token metrics, so its sessions in the period are counted with no tokens.
  const codexSessionCount = sessions.filter((session) => session.provider === 'codex' && session.lastEventAt >= windowStartedAt).length
  const codexRows: UsageBySource[] =
    codexSessionCount === 0
      ? []
      : [{ sourceKey: 'codex', label: agentLabels.codex, note: 'No token metrics', sessionCount: codexSessionCount, tokens: emptyTokenTotals() }]
  const agentOfSample = (sample: StoredTokenSample): AgentProvider => sessionOf(sample)?.provider ?? 'claude'
  const byAgent = [
    ...sourceRows(samples, agentOfSample, (sourceKey) => ({ label: agentLabels[agentProviderOf(sourceKey)], note: null })),
    ...codexRows,
  ]

  return {
    windowStartedAt,
    generatedAt: new Date(now).toISOString(),
    totals: sumTokens(samples),
    sessionCount: distinctSessions(samples),
    byRepository,
    byWork,
    byDay,
    byModel,
    byMachine: sourceRows(samples, (sample) => sample.machineTokenId ?? '', machineRowOf(lookups.machineLabelOf)),
    byTrigger: sourceRows(samples, triggerOfSample, (label) => ({ label, note: originNoteOf(label) })),
    byBilling: sourceRows(samples, billingOfSample, (label) => ({ label, note: originNoteOf(label) })),
    byAgent,
  }
}
