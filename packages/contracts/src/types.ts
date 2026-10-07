export interface RepositoryReference {
  owner: string
  name: string
}

export type GateState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'

export interface CheckGate {
  name: string
  state: GateState
  url: string | null
}

export type GateOverallState = 'none' | 'passing' | 'running' | 'failing'

export interface GateSummary {
  passed: number
  failed: number
  pending: number
  total: number
  overallState: GateOverallState
}

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

export type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

export type MediaKind = 'image' | 'video'

// What a pull request's preview recording can hold: its screenshot and video, and the base
// branch's screenshot of the same route, to compare it with.
export type PreviewMediaKind = MediaKind | 'before'

export interface PullRequestMedia {
  hasImage: boolean
  hasVideo: boolean
}

export type ChangedFileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'

export interface ChangedFile {
  filename: string
  previousFilename: string | null
  status: ChangedFileStatus
  additions: number
  deletions: number
  patch: string | null
  blobUrl: string
}

export interface PullRequestFiles {
  files: ChangedFile[]
  isTruncated: boolean
}

export interface PullRequestSummary {
  number: number
  title: string
  url: string
  isDraft: boolean
  headRefName: string
  headSha: string | null
  reviewDecision: ReviewDecision
  mergeable: Mergeable
  body: string
  updatedAt: string
  gates: CheckGate[]
  gateSummary: GateSummary
  media: PullRequestMedia
  previewUrl: string | null
}

export interface IssueLabel {
  name: string
  color: string
}

export interface IssueSummary {
  number: number
  title: string
  url: string
  updatedAt: string
  closedAt: string | null
  labels: IssueLabel[]
  linkedPullRequestNumbers: number[]
}

export type IssueStatus =
  | 'no-pull-request'
  | 'draft'
  | 'checks-running'
  | 'checks-failing'
  | 'ready-for-review'
  | 'approved'
  | 'closed'

export interface BoardCard {
  issues: IssueSummary[]
  pullRequest: PullRequestSummary | null
  status: IssueStatus
}

export interface BoardColumn {
  status: IssueStatus
  cards: BoardCard[]
}

export interface Board {
  repository: RepositoryReference
  columns: BoardColumn[]
  fetchedAt: string
}

export type NetlifyStatus =
  | { state: 'active'; siteName: string; siteUrl: string; adminUrl: string }
  | { state: 'inactive' }
  | { state: 'missing-token' }

export type VaultMode = 'environment' | 'passphrase'

export interface VaultState {
  mode: VaultMode
  initialised: boolean
  unlocked: boolean
}

export interface SecretDefinition {
  name: string
  label: string
  description: string
  tokenPageUrl: string
}

// One stored token of a credential; a credential can hold several, and the one in use is the one
// the dashboard reads.
export interface SecretEntrySummary {
  entryId: string
  label: string
  lastFour: string
  isInUse: boolean
  updatedAt: string
}

export interface SecretSummary {
  name: string
  label: string
  description: string
  tokenPageUrl: string
  entries: SecretEntrySummary[]
}

export interface CreatedSecretEntry {
  entryId: string
}

export interface NewSecretEntry {
  label: string
  value: string
  // The first token of a credential is in use whatever this says.
  useNow: boolean
}

export interface SecretEntryChange {
  label?: string
  value?: string
}

export interface SecretTestResult {
  ok: boolean
  status: number | null
  message: string
}

export interface ApiError {
  error: string
}

export interface SignedInUser {
  login: string
  avatarUrl: string
}

export interface SessionState {
  signInRequired: boolean
  signInAvailable: boolean
  user: SignedInUser | null
}

export type AgentProvider = 'claude' | 'codex'

// `inactive` is a session that never reported its end but has been silent too long to be
// running: a closed terminal, a crashed machine.
export type AgentSessionState = 'working' | 'waiting' | 'idle' | 'ended' | 'inactive'

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface AgentSessionSummary {
  sessionId: string
  provider: AgentProvider
  repository: RepositoryReference | null
  branch: string | null
  title: string | null
  folder: string | null
  issueNumber: number | null
  state: AgentSessionState
  startedAt: string
  lastEventAt: string
  tokens: TokenTotals
  // What started the session, such as "Dashi board (laptop runner)" or "CodePilot", and what paid for it.
  triggeredBy: string
  billedThrough: string
}

export interface SessionTimelineSegment {
  sessionId: string
  state: AgentSessionState
  startedAt: string
  endedAt: string
}

export interface SessionsOverview {
  sessions: AgentSessionSummary[]
  timeline: SessionTimelineSegment[]
  windowStartedAt: string
  generatedAt: string
}

export interface UsageByRepository {
  repository: RepositoryReference | null
  tokens: TokenTotals
  sessionCount: number
}

export interface UsageByWork {
  repository: RepositoryReference | null
  branch: string | null
  issueNumber: number | null
  pullRequestNumber: number | null
  // What started its sessions and what paid for them, the largest share first.
  triggeredBy: string[]
  billedThrough: string[]
  tokens: TokenTotals
  sessionCount: number
}

export interface UsageByDay {
  day: string
  tokens: TokenTotals
}

export interface UsageByModel {
  model: string
  tokens: TokenTotals
}

// Tokens grouped by where they were spent: what triggered the session, what paid for it, the machine, or the agent.
export interface UsageBySource {
  sourceKey: string
  label: string
  // Why a row is partial or unknown, such as an agent that sends no token metrics.
  note: string | null
  sessionCount: number
  tokens: TokenTotals
}

export interface UsageReport {
  windowStartedAt: string
  generatedAt: string
  totals: TokenTotals
  sessionCount: number
  byRepository: UsageByRepository[]
  byWork: UsageByWork[]
  byDay: UsageByDay[]
  byModel: UsageByModel[]
  byTrigger: UsageBySource[]
  byBilling: UsageBySource[]
  byMachine: UsageBySource[]
  byAgent: UsageBySource[]
}

export interface MachineTokenSummary {
  tokenId: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export type MachineTokenKind = 'ingest' | 'runner'

export interface CreatedMachineToken {
  summary: MachineTokenSummary
  token: string
}

export type StartWorkflow =
  | 'research'
  | 'feature'
  | 'fix'
  | 'refactor'
  | 'docs'
  | 'design'
  | '3d'
  | 'security'
  | 'tests'
  | 'chore'
  | 'conflicts'

export type StartTarget = 'laptop-remote-control' | 'laptop-headless' | 'laptop-cloud' | 'cloud-routine'

export type HeadlessPermissionMode = 'auto' | 'acceptEdits' | 'dontAsk'

export type SessionStartState = 'queued' | 'claimed' | 'started' | 'failed'

export interface SessionStartRequest {
  repository: RepositoryReference
  issueNumber: number | null
  pullRequestNumber: number | null
  workflow: StartWorkflow
  target: StartTarget
  permissionMode: HeadlessPermissionMode
  note: string
}

// A file sent along with a start. It is never stored: the dashboard hands it to the session and drops it.
export interface StartAttachment {
  name: string
  mediaType: string
  base64: string
}

export interface SessionStartSubmission extends SessionStartRequest {
  attachments: StartAttachment[]
}

export interface NewIssueRequest {
  title: string
  body: string
}

export interface CreatedIssue {
  number: number
  url: string
}

export interface SessionStart extends SessionStartRequest {
  startId: string
  state: SessionStartState
  runnerLabel: string | null
  sessionUrl: string | null
  message: string | null
  createdAt: string
  updatedAt: string
}

export interface RunnerPresence {
  label: string
  lastSeenAt: string
  isOnline: boolean
}

// Laptop sessions get attachments as files; the others only take text, so theirs travel inside
// the prompt as base64 and have to stay small.
export interface AttachmentLimits {
  fileCount: number
  fileTargetBytes: number
  inlineTargetBytes: number
}

export interface StartOptions {
  runners: RunnerPresence[]
  routineConfigured: boolean
  attachmentLimits: AttachmentLimits
}

export interface RoutineSettings {
  configured: boolean
  routineId: string | null
}

export type RoutineTestResult = { ok: true; sessionUrl: string } | { ok: false; message: string }

export interface SessionStartDetails {
  start: SessionStart
  firstMessage: string
}

export interface ServedScriptInfo {
  sha256: string
  byteLength: number
  sourcePath: string
}

export type ChatMessageRole = 'user' | 'assistant'

export type ChatMessageKind = 'text' | 'tool'

export interface ChatMessage {
  messageId: string
  role: ChatMessageRole
  kind: ChatMessageKind
  text: string
  toolName: string | null
  createdAt: string | null
}

// How the runner can put a message into a session: pasted into its tmux pane, or by resuming an
// ended session headless.
export type ChatDeliveryRoute = 'tmux' | 'resume' | 'none'

export type ChatDeliveryState = 'queued' | 'sent' | 'delivered' | 'failed'

export interface ChatDelivery {
  deliveryId: string
  text: string
  state: ChatDeliveryState
  message: string | null
  createdAt: string
}

export type SessionChatAvailability = 'runner-offline' | 'waiting-for-runner' | 'on-laptop' | 'not-on-laptop'

export interface SessionChat {
  sessionId: string
  availability: SessionChatAvailability
  deliveryRoute: ChatDeliveryRoute
  sendBlocker: string | null
  messages: ChatMessage[]
  deliveries: ChatDelivery[]
  updatedAt: string | null
}

export type MachinePlatform = 'macos' | 'linux'

export interface PairingRequest {
  hostname: string
  platform: MachinePlatform
}

// The poll secret goes only to the CLI that asked; the code is what the person sees and approves.
export interface CreatedPairing {
  pairingId: string
  userCode: string
  pollSecret: string
  approvePath: string
  expiresAt: string
}

export interface PairingDescription {
  userCode: string
  hostname: string
  platform: MachinePlatform
  expiresAt: string
}

export interface PairingApproval {
  userCode: string
  label: string
  withRunner: boolean
}

export type PairingPoll = { state: 'pending' } | { state: 'approved'; label: string; ingestToken: string; runnerToken: string | null }

export interface MachineIdentity {
  kind: MachineTokenKind
  label: string
  lastUsedAt: string | null
}

