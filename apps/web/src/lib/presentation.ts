import type {
  CostTotals,
  AgentProvider,
  AgentSessionState,
  GateOverallState,
  GateState,
  HeadlessPermissionMode,
  IssueStatus,
  RepositoryReference,
  SessionStartState,
  StartAgent,
  StartTarget,
} from '@dashi/contracts'
import type { EpicTicketState, GateRingGroup, RadixColor, StartModelSource } from './types'

export const issueStatusLabels: Record<IssueStatus, string> = {
  'no-pull-request': 'No pull request',
  draft: 'Draft',
  'checks-running': 'Checks running',
  'checks-failing': 'Checks failing',
  'ready-for-review': 'Ready for review',
  approved: 'Approved',
  closed: 'Closed',
}

export const issueStatusColors: Record<IssueStatus, RadixColor> = {
  'no-pull-request': 'gray',
  draft: 'sky',
  'checks-running': 'amber',
  'checks-failing': 'red',
  'ready-for-review': 'indigo',
  approved: 'green',
  closed: 'purple',
}

export const epicTicketStateLabels: Record<EpicTicketState, string> = {
  blocked: 'Blocked',
  ready: 'Ready',
  'in-progress': 'In progress',
  closed: 'Closed',
}

export const epicTicketStateColors: Record<EpicTicketState, RadixColor> = {
  blocked: 'orange',
  ready: 'green',
  'in-progress': 'sky',
  closed: 'purple',
}

export const gateStateColors: Record<GateState, RadixColor> = {
  success: 'green',
  failure: 'red',
  pending: 'amber',
  neutral: 'gray',
  skipped: 'gray',
}

export const gateOverallColors: Record<GateOverallState, RadixColor> = {
  none: 'gray',
  passing: 'green',
  running: 'amber',
  failing: 'red',
}

export const gateStateLabels: Record<GateState, string> = {
  success: 'Passed',
  failure: 'Failed',
  pending: 'Running',
  neutral: 'Neutral',
  skipped: 'Skipped',
}

export const gateRingColors: Record<GateRingGroup, string> = {
  failure: 'var(--red-9)',
  pending: 'var(--amber-9)',
  success: 'var(--green-9)',
  other: 'var(--gray-8)',
}

export const startTargetLabels: Record<StartTarget, { name: string; description: string }> = {
  'laptop-remote-control': {
    name: 'Laptop, steered from the phone',
    description: 'Interactive Claude on the laptop with Remote Control. Open it in the Claude app.',
  },
  'laptop-headless': {
    name: 'Laptop, unattended',
    description: 'Runs to the end without asking. Follow it on the Sessions page.',
  },
  'laptop-cloud': {
    name: 'Claude cloud, sent from the laptop',
    description: 'The laptop starts a claude.ai/code session and hands back its link.',
  },
  'cloud-routine': {
    name: 'Claude cloud routine',
    description: "Works with the laptop off. Uses this repository's routine.",
  },
}

export const startTargetOrder: StartTarget[] = ['laptop-remote-control', 'laptop-headless', 'laptop-cloud', 'cloud-routine']


export const startAgentOrder: StartAgent[] = ['claude', 'opencode']

export const startAgentLabels: Record<StartAgent, string> = { claude: 'Claude Code', opencode: 'OpenCode' }

// OpenCode's own provider serves only OpenCode, so Claude Code is never offered its models.
export const startModelSourceOrders: Record<StartAgent, StartModelSource[]> = {
  claude: ['default', 'claude', 'openrouter'],
  opencode: ['default', 'openrouter', 'opencode'],
}

export const startModelSourceLabels: Record<StartAgent, Record<StartModelSource, string>> = {
  // Short, so three fit side by side at phone width.
  claude: { default: 'Login default', claude: 'Claude', openrouter: 'OpenRouter', opencode: 'OpenCode' },
  opencode: { default: 'Default', claude: 'Claude', openrouter: 'OpenRouter', opencode: 'OpenCode' },
}

// OpenCode has no edits-only mode: its own permission settings decide, and --auto approves what they do not deny.
export const permissionModeOrders: Record<StartAgent, HeadlessPermissionMode[]> = {
  claude: ['auto', 'acceptEdits', 'dontAsk'],
  opencode: ['auto', 'dontAsk'],
}

export const permissionModeLabels: Record<StartAgent, Record<HeadlessPermissionMode, string>> = {
  claude: {
    auto: 'Auto: a classifier approves safe actions',
    acceptEdits: 'Accept edits: file changes only',
    dontAsk: 'Only tools already allowed in settings',
  },
  opencode: {
    auto: 'Auto: approve all but what is denied',
    acceptEdits: "Only what OpenCode's settings allow",
    dontAsk: "Only what OpenCode's settings allow",
  },
}

export const sessionStartStateColors: Record<SessionStartState, RadixColor> = {
  queued: 'gray',
  claimed: 'amber',
  started: 'green',
  failed: 'red',
}

export const sessionStartStateLabels: Record<SessionStartState, string> = {
  queued: 'Waiting for the runner',
  claimed: 'Starting',
  started: 'Started',
  failed: 'Failed',
}

export const gateOverallLabels: Record<GateOverallState, string> = {
  none: 'No checks',
  passing: 'All checks passed',
  running: 'Checks running',
  failing: 'Checks failing',
}

/**
 * Names a repository as owner/name, for keys, labels and the URL.
 * @param repository The repository.
 * @returns owner/name.
 */
export const repositoryKey = (repository: { owner: string; name: string }): string => `${repository.owner}/${repository.name}`

/**
 * Reads an owner/name key back into a repository.
 * @param key The key, usually from the URL.
 * @returns The repository, or null when the key is malformed.
 */
export const parseRepositoryKey = (key: string): { owner: string; name: string } | null => {
  const [owner, name, ...extraParts] = key.split('/')
  return owner && name && extraParts.length === 0 ? { owner, name } : null
}

/**
 * Turns anything thrown into text for a toast or a callout.
 * @param errorOrText An Error or any other thrown value.
 * @returns The message.
 */
export const errorMessageOf = (errorOrText: unknown): string =>
  errorOrText instanceof Error ? errorOrText.message : String(errorOrText)

export const signInErrorMessages: Record<string, string> = {
  expired: 'That sign-in link expired or was opened in another browser. Start again.',
  'not-allowed': 'This GitHub account is not on the list of people who may use this dashboard.',
  failed: 'GitHub did not complete the sign-in. Try again.',
}

export const sessionStateLabels: Record<AgentSessionState, string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  idle: 'Idle',
  inactive: 'Inactive',
  ended: 'Ended',
}

export const sessionStateColors: Record<AgentSessionState, RadixColor> = {
  working: 'blue',
  waiting: 'orange',
  idle: 'jade',
  inactive: 'gray',
  ended: 'gray',
}

export const providerLabels: Record<AgentProvider, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' }

const compactNumberFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const fullNumberFormat = new Intl.NumberFormat('en')

/**
 * Writes a count exactly below ten thousand and compactly above, as 12.9K or 4.2M.
 * @param value The count.
 * @returns The formatted count.
 */
export const formatCompactCount = (value: number): string =>
  value < 10_000 ? fullNumberFormat.format(value) : compactNumberFormat.format(value)

/**
 * Writes a count in full with thousands separators, for tooltips.
 * @param value The count.
 * @returns The formatted count.
 */
export const formatFullCount = (value: number): string => fullNumberFormat.format(value)

/**
 * Writes a share as a whole percentage.
 * @param share The share, from 0 to 1.
 * @returns The percentage, such as 38%.
 */
export const formatPercent = (share: number): string => `${Math.round(share * 100)}%`

const minuteMilliseconds = 60_000

/**
 * Writes a duration in hours and minutes.
 * @param milliseconds The duration.
 * @returns The duration, such as 1 h 5 min.
 */
export const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(0, Math.round(milliseconds / minuteMilliseconds))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/**
 * Writes how long ago something happened.
 * @param isoTime When it happened.
 * @param now The current time in milliseconds.
 * @returns The elapsed time, or just now inside the last minute.
 */
export const formatTimeAgo = (isoTime: string, now: number): string => {
  const elapsed = now - Date.parse(isoTime)
  return elapsed < minuteMilliseconds ? 'just now' : `${formatDuration(elapsed)} ago`
}

/**
 * Builds the GitHub address of an issue.
 * @param repository The repository.
 * @param issueNumber The issue number.
 * @returns The issue URL.
 */
export const gitHubIssueUrl = (repository: RepositoryReference, issueNumber: number): string =>
  `https://github.com/${repository.owner}/${repository.name}/issues/${issueNumber}`

/**
 * Builds the GitHub address of a pull request.
 * @param repository The repository.
 * @param pullRequestNumber The pull request number.
 * @returns The pull request URL.
 */
export const gitHubPullRequestUrl = (repository: RepositoryReference, pullRequestNumber: number): string =>
  `https://github.com/${repository.owner}/${repository.name}/pull/${pullRequestNumber}`

const dollarFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * Writes what tokens cost. Tokens of a model with no price are never guessed at: a cost made only
 * of them reads n/a, and a cost with some of them reads as a lower bound with a plus.
 * @param cost The cost and the count of tokens that had no price.
 * @returns The text to show, such as $12.40, $12.40+ or n/a.
 */
export const formatCost = (cost: CostTotals): string => {
  if (cost.usd === 0 && cost.unpricedTokens > 0) return 'n/a'
  const text = cost.usd > 0 && cost.usd < 0.01 ? '<$0.01' : dollarFormat.format(cost.usd)
  return cost.unpricedTokens > 0 ? `${text}+` : text
}
