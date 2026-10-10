import type {
  ChatMessage,
  SessionStart,
  AgentSessionState,
  AgentSessionSummary,
  MachineTokenSummary,
  SessionTimelineSegment,
  SessionsOverview,
  TokenTotals,
  UsageReport,
} from '@dashi/contracts'
import { sampleRepositories } from './sample-data'

const minuteMilliseconds = 60_000
const hourMilliseconds = 60 * minuteMilliseconds
const dayMilliseconds = 24 * hourMilliseconds

const [firstRepository, secondRepository] = sampleRepositories

const tokensOf = (input: number, output: number, cacheRead: number, cacheCreation: number): TokenTotals => ({
  input,
  output,
  cacheRead,
  cacheCreation,
  total: input + output + cacheRead + cacheCreation,
})

const addTokens = (first: TokenTotals, second: TokenTotals): TokenTotals =>
  tokensOf(
    first.input + second.input,
    first.output + second.output,
    first.cacheRead + second.cacheRead,
    first.cacheCreation + second.cacheCreation,
  )

// Each sample session is a list of [minutes ago, state] changes, newest last.
interface SampleSession {
  sessionId: string
  repositoryIndex: number | null
  branch: string | null
  title: string | null
  folder: string | null
  issueNumber: number | null
  changes: [number, AgentSessionState][]
  tokens: TokenTotals
  triggeredBy: string
  billedThrough: string
}

const sampleSessions: SampleSession[] = [
  {
    sessionId: 'c1a7e3d2-demo-working',
    repositoryIndex: 0,
    branch: 'feat/12-sessions-and-usage',
    title: 'Add the Sessions page with token usage',
    folder: 'example',
    issueNumber: 12,
    changes: [[310, 'idle'], [305, 'working'], [240, 'waiting'], [228, 'working'], [150, 'idle'], [95, 'working']],
    tokens: tokensOf(48_200, 131_900, 3_904_000, 212_400),
    triggeredBy: 'Dashi board (laptop runner)',
    billedThrough: 'Claude login · me@example.com',
  },
  {
    sessionId: 'b9f04c11-demo-waiting',
    repositoryIndex: 1,
    branch: 'fix/31-retry-webhooks',
    title: 'Retry webhooks that time out',
    folder: 'example-api',
    issueNumber: 31,
    changes: [[180, 'idle'], [176, 'working'], [120, 'idle'], [70, 'working'], [12, 'waiting']],
    tokens: tokensOf(21_800, 64_300, 1_720_500, 98_100),
    triggeredBy: 'CodePilot',
    billedThrough: 'Anthropic API key',
  },
  {
    sessionId: '5e2d8a90-demo-idle',
    repositoryIndex: 0,
    branch: 'docs/9-deploy-guide',
    title: 'Write the deploy guide',
    folder: 'example',
    issueNumber: 9,
    changes: [[620, 'idle'], [612, 'working'], [540, 'idle'], [300, 'working'], [262, 'idle']],
    tokens: tokensOf(9_400, 27_600, 684_000, 41_900),
    triggeredBy: 'Terminal (iTerm)',
    billedThrough: 'Claude login · me@example.com',
  },
  {
    sessionId: '7ac3f5b8-demo-codex',
    repositoryIndex: 1,
    branch: 'main',
    title: null,
    folder: 'example-api',
    issueNumber: null,
    changes: [[80, 'idle'], [44, 'idle']],
    tokens: tokensOf(0, 0, 0, 0),
    triggeredBy: 'Terminal (Ghostty)',
    billedThrough: 'ChatGPT login',
  },
  {
    sessionId: 'e4410c6f-demo-ended',
    repositoryIndex: 0,
    branch: 'chore/7-bump-dependencies',
    title: 'Bump the dependencies',
    folder: 'example',
    issueNumber: 7,
    changes: [[1_100, 'idle'], [1_095, 'working'], [1_010, 'idle'], [1_000, 'ended']],
    tokens: tokensOf(6_100, 18_900, 402_300, 30_200),
    triggeredBy: 'Dashi board (Claude cloud)',
    billedThrough: 'Claude login · me@example.com',
  },
  {
    sessionId: '0d93b7aa-demo-notes',
    repositoryIndex: null,
    branch: null,
    title: 'Draft the release notes for 2.0',
    folder: 'notes',
    issueNumber: null,
    changes: [[40, 'working'], [25, 'idle']],
    tokens: tokensOf(2_300, 8_100, 96_000, 6_200),
    triggeredBy: 'VS Code',
    billedThrough: 'OpenRouter',
  },
]

const repositoryAt = (repositoryIndex: number | null) =>
  repositoryIndex === null ? null : (sampleRepositories[repositoryIndex] ?? null)

const isoMinutesAgo = (now: number, minutesAgo: number): string => new Date(now - minutesAgo * minuteMilliseconds).toISOString()

const segmentsOf = (sample: SampleSession, now: number): SessionTimelineSegment[] =>
  sample.changes.flatMap(([minutesAgo, state], changeIndex): SessionTimelineSegment[] => {
    const nextChange = sample.changes[changeIndex + 1]
    if (state === 'ended') return []
    return [
      {
        sessionId: sample.sessionId,
        state,
        startedAt: isoMinutesAgo(now, minutesAgo),
        endedAt: isoMinutesAgo(now, nextChange === undefined ? 0 : nextChange[0]),
      },
    ]
  })

const summaryOf = (sample: SampleSession, now: number): AgentSessionSummary => {
  const firstChange = sample.changes[0]
  const lastChange = sample.changes.at(-1)
  return {
    sessionId: sample.sessionId,
    provider: sample.sessionId.includes('codex') ? 'codex' : 'claude',
    repository: repositoryAt(sample.repositoryIndex),
    branch: sample.branch,
    title: sample.title,
    folder: sample.folder,
    issueNumber: sample.issueNumber,
    state: lastChange?.[1] ?? 'idle',
    startedAt: isoMinutesAgo(now, firstChange?.[0] ?? 0),
    lastEventAt: isoMinutesAgo(now, lastChange?.[0] ?? 0),
    tokens: sample.tokens,
    triggeredBy: sample.triggeredBy,
    billedThrough: sample.billedThrough,
  }
}

/**
 * Builds demo sessions and their timeline relative to now, so demo mode always looks current.
 * @param hours The window asked for.
 * @param now The current time in milliseconds.
 * @returns The demo sessions overview.
 */
export const sampleSessionsOverview = (hours: number, now: number): SessionsOverview => {
  const windowStartedAt = new Date(now - hours * hourMilliseconds).toISOString()
  const summaries = sampleSessions.map((sample) => summaryOf(sample, now)).filter((session) => session.lastEventAt >= windowStartedAt)
  const includedIds = new Set(summaries.map((session) => session.sessionId))
  return {
    sessions: summaries,
    timeline: sampleSessions
      .filter((sample) => includedIds.has(sample.sessionId))
      .flatMap((sample) => segmentsOf(sample, now))
      .map((segment) => ({ ...segment, startedAt: segment.startedAt < windowStartedAt ? windowStartedAt : segment.startedAt }))
      .filter((segment) => segment.endedAt > segment.startedAt),
    windowStartedAt,
    generatedAt: new Date(now).toISOString(),
  }
}

// A repeatable weekly rhythm rather than random numbers, so every reload shows the same chart.
const dailyScale = [0.2, 1, 0.85, 1.3, 0.7, 1.1, 0]

/**
 * Builds a demo usage report with a fixed weekly rhythm, so every reload shows the same chart.
 * @param days The period asked for.
 * @param now The current time in milliseconds.
 * @returns The demo usage report.
 */
export const sampleUsageReport = (days: number, now: number): UsageReport => {
  const windowStartedAt = new Date(now - days * dayMilliseconds).toISOString()
  const byDay = Array.from({ length: days }, (_, dayIndex) => {
    const scale = dailyScale[dayIndex % dailyScale.length] ?? 0
    return {
      day: new Date(now - (days - 1 - dayIndex) * dayMilliseconds).toISOString().slice(0, 10),
      tokens: tokensOf(Math.round(12_000 * scale), Math.round(35_000 * scale), Math.round(910_000 * scale), Math.round(52_000 * scale)),
    }
  }).filter((usage) => usage.tokens.total > 0)
  const totals = byDay.reduce((sum, usage) => addTokens(sum, usage.tokens), tokensOf(0, 0, 0, 0))
  const scaled = (share: number): TokenTotals =>
    tokensOf(
      Math.round(totals.input * share),
      Math.round(totals.output * share),
      Math.round(totals.cacheRead * share),
      Math.round(totals.cacheCreation * share),
    )
  return {
    windowStartedAt,
    generatedAt: new Date(now).toISOString(),
    totals,
    sessionCount: 23,
    byRepository: [
      { repository: firstRepository ?? null, tokens: scaled(0.64), sessionCount: 15 },
      { repository: secondRepository ?? null, tokens: scaled(0.31), sessionCount: 6 },
      { repository: null, tokens: scaled(0.05), sessionCount: 2 },
    ],
    byWork: [
      { repository: firstRepository ?? null, branch: 'feat/12-sessions-and-usage', issueNumber: 12, pullRequestNumber: 14, triggeredBy: ['Dashi board (laptop runner)', 'Terminal (iTerm)'], billedThrough: ['Claude login · me@example.com'], tokens: scaled(0.38), sessionCount: 6 },
      { repository: secondRepository ?? null, branch: 'fix/31-retry-webhooks', issueNumber: 31, pullRequestNumber: 33, triggeredBy: ['CodePilot'], billedThrough: ['Anthropic API key'], tokens: scaled(0.21), sessionCount: 4 },
      { repository: firstRepository ?? null, branch: 'docs/9-deploy-guide', issueNumber: 9, pullRequestNumber: null, triggeredBy: ['Terminal (iTerm)'], billedThrough: ['Claude login · me@example.com'], tokens: scaled(0.17), sessionCount: 5 },
      { repository: secondRepository ?? null, branch: 'main', issueNumber: null, pullRequestNumber: null, triggeredBy: ['VS Code'], billedThrough: ['OpenRouter'], tokens: scaled(0.1), sessionCount: 2 },
      { repository: firstRepository ?? null, branch: 'chore/7-bump-dependencies', issueNumber: 7, pullRequestNumber: 8, triggeredBy: ['Dashi board (Claude cloud)'], billedThrough: ['Claude login · me@example.com'], tokens: scaled(0.09), sessionCount: 4 },
      { repository: null, branch: null, issueNumber: null, pullRequestNumber: null, triggeredBy: ['Not reported'], billedThrough: ['Not reported'], tokens: scaled(0.05), sessionCount: 2 },
    ],
    byDay,
    byModel: [
      { model: 'claude-opus-demo', tokens: scaled(0.72) },
      { model: 'claude-haiku-demo', tokens: scaled(0.28) },
    ],
    byTrigger: [
      { sourceKey: 'Dashi board (laptop runner)', label: 'Dashi board (laptop runner)', note: null, sessionCount: 6, tokens: scaled(0.34) },
      { sourceKey: 'CodePilot', label: 'CodePilot', note: null, sessionCount: 4, tokens: scaled(0.21) },
      { sourceKey: 'Terminal (iTerm)', label: 'Terminal (iTerm)', note: null, sessionCount: 7, tokens: scaled(0.21) },
      { sourceKey: 'VS Code', label: 'VS Code', note: null, sessionCount: 2, tokens: scaled(0.1) },
      { sourceKey: 'Dashi board (Claude cloud)', label: 'Dashi board (Claude cloud)', note: null, sessionCount: 3, tokens: scaled(0.09) },
      { sourceKey: 'Not reported', label: 'Not reported', note: 'Recorded before Dashi asked, or the workflow plugin is older than 0.5.0', sessionCount: 1, tokens: scaled(0.05) },
    ],
    byBilling: [
      { sourceKey: 'Claude login · me@example.com', label: 'Claude login · me@example.com', note: null, sessionCount: 16, tokens: scaled(0.64) },
      { sourceKey: 'Anthropic API key', label: 'Anthropic API key', note: null, sessionCount: 4, tokens: scaled(0.21) },
      { sourceKey: 'OpenRouter', label: 'OpenRouter', note: null, sessionCount: 2, tokens: scaled(0.1) },
      { sourceKey: 'Not reported', label: 'Not reported', note: 'Recorded before Dashi asked, or the workflow plugin is older than 0.5.0', sessionCount: 1, tokens: scaled(0.05) },
    ],
    byMachine: [
      { sourceKey: 'demo-laptop', label: 'Laptop', note: null, sessionCount: 17, tokens: scaled(0.7) },
      { sourceKey: 'demo-runner', label: 'Mac mini', note: null, sessionCount: 6, tokens: scaled(0.3) },
    ],
    byAgent: [
      { sourceKey: 'claude', label: 'Claude Code', note: null, sessionCount: 23, tokens: scaled(1) },
      { sourceKey: 'codex', label: 'Codex', note: 'No token metrics', sessionCount: 2, tokens: tokensOf(0, 0, 0, 0) },
    ],
  }
}

export const sampleIngestTokens: MachineTokenSummary[] = [
  { tokenId: 'demo-laptop', label: 'Laptop', createdAt: '2026-09-20T09:00:00Z', lastUsedAt: '2026-09-29T08:40:00Z' },
]

export const sampleRunnerTokens: MachineTokenSummary[] = [
  { tokenId: 'demo-runner', label: 'Mac mini', createdAt: '2026-09-30T09:00:00Z', lastUsedAt: '2026-09-30T13:00:00Z' },
]

const minutesBefore = (now: number, minutes: number): string => new Date(now - minutes * 60_000).toISOString()

/**
 * The sample starts, timed back from now so the Sessions page's time window always has some: a
 * routine start whose token stopped matching, one that started, and one on the laptop.
 * @param now The current time in milliseconds.
 * @returns The starts, newest first.
 */
export const sampleSessionStarts = (now: number): SessionStart[] => [
  {
    startId: 'demo-start-failed',
    repository: { owner: 'cnotv', name: 'example' },
    issueNumber: 5,
    pullRequestNumber: null,
    workflow: 'feature',
    target: 'cloud-routine',
    permissionMode: 'auto',
    openRouterModel: null,
    note: '',
    state: 'failed',
    runnerLabel: null,
    sessionUrl: null,
    message: 'Authentication failed',
    createdAt: minutesBefore(now, 20),
    updatedAt: minutesBefore(now, 20),
  },
  {
    startId: 'demo-start-cloud',
    repository: { owner: 'cnotv', name: 'example' },
    issueNumber: 12,
    pullRequestNumber: null,
    workflow: 'feature',
    target: 'cloud-routine',
    permissionMode: 'auto',
    openRouterModel: null,
    note: '',
    state: 'started',
    runnerLabel: null,
    sessionUrl: 'https://claude.ai/code/session_01DemoRoutineStart',
    message: null,
    createdAt: minutesBefore(now, 90),
    updatedAt: minutesBefore(now, 90),
  },
  {
    startId: 'demo-start-laptop',
    repository: { owner: 'cnotv', name: 'example' },
    issueNumber: 7,
    pullRequestNumber: null,
    workflow: 'fix',
    target: 'laptop-remote-control',
    permissionMode: 'auto',
    openRouterModel: null,
    note: 'Only the physics step.',
    state: 'started',
    runnerLabel: 'Mac mini',
    sessionUrl: null,
    message: 'Open "example #7 fix" in the Claude app; on the laptop, tmux attach -t agent-example-demo',
    createdAt: minutesBefore(now, 60 * 30),
    updatedAt: minutesBefore(now, 60 * 30),
  },
  {
    startId: 'demo-start-openrouter',
    repository: { owner: 'cnotv', name: 'example' },
    issueNumber: 9,
    pullRequestNumber: null,
    workflow: 'docs',
    target: 'laptop-headless',
    permissionMode: 'acceptEdits',
    openRouterModel: 'meta-llama/llama-3.3-70b-instruct:free',
    note: '',
    state: 'started',
    runnerLabel: 'Mac mini',
    sessionUrl: null,
    message: 'Running unattended in ~/dashi/worktrees/example-demo0009; its output goes to ~/dashi/logs/example-demo0009.log',
    createdAt: minutesBefore(now, 60 * 4),
    updatedAt: minutesBefore(now, 60 * 4),
  },
]

export const sampleChatMessages: ChatMessage[] = [
  {
    messageId: 'demo-1',
    role: 'user',
    kind: 'text',
    text: '/workflow:start fix https://github.com/cnotv/example/issues/7',
    toolName: null,
    createdAt: '2026-09-30T10:00:00Z',
  },
  {
    messageId: 'demo-2',
    role: 'assistant',
    kind: 'text',
    text: 'Reading issue #7: marbles stick to the ramp edge. I will reproduce it with a unit test first.',
    toolName: null,
    createdAt: '2026-09-30T10:00:04Z',
  },
  { messageId: 'demo-3', role: 'assistant', kind: 'tool', text: 'gh issue view 7 --comments', toolName: 'Bash', createdAt: '2026-09-30T10:00:05Z' },
  {
    messageId: 'demo-4',
    role: 'assistant',
    kind: 'tool',
    text: 'src/views/Games/MarbleMadness/physics.ts',
    toolName: 'Read',
    createdAt: '2026-09-30T10:00:09Z',
  },
  {
    messageId: 'demo-5',
    role: 'assistant',
    kind: 'text',
    text: 'The speed is never clamped, so a fast marble tunnels through the edge collider.\n\nI added a failing test and a clamp of 40 units a second; the test passes now. Shall I open the draft pull request?',
    toolName: null,
    createdAt: '2026-09-30T10:03:40Z',
  },
]

// A cloud session's chat holds only what its hooks carry: each prompt and each turn's final reply.
export const sampleCloudChatMessages: ChatMessage[] = [
  {
    messageId: 'demo-cloud-1',
    role: 'user',
    kind: 'text',
    text: '/workflow:start feature https://github.com/cnotv/example/issues/12',
    toolName: null,
    createdAt: '2026-10-08T09:20:00Z',
  },
  {
    messageId: 'demo-cloud-2',
    role: 'assistant',
    kind: 'text',
    text: 'Issue #12 asks for a dark mode toggle, but not where it should live: in the header, or under Settings?',
    toolName: null,
    createdAt: '2026-10-08T09:21:30Z',
  },
  {
    messageId: 'demo-cloud-3',
    role: 'user',
    kind: 'text',
    text: 'In the header, next to the account menu.',
    toolName: null,
    createdAt: '2026-10-08T09:25:00Z',
  },
  {
    messageId: 'demo-cloud-4',
    role: 'assistant',
    kind: 'text',
    text: 'Done: the toggle sits next to the account menu and remembers the choice. Draft pull request #13 is open, and its checks are green.',
    toolName: null,
    createdAt: '2026-10-08T09:41:10Z',
  },
]
