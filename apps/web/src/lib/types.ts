import type {
  AgentSessionState,
  StartAgent,
  ChatDelivery,
  ChatMessage,
  Board,
  BoardCard,
  CreatedMachineToken,
  IssueStatus,
  MachineTokenSummary,
  MachineTokenKind,
  MachinePlatform,
  NetlifyStatus,
  PreviewMediaKind,
  PairingApproval,
  PairingDescription,
  PullRequestFiles,
  PullRequestSummary,
  SessionChat,
  RepositoryReference,
  RoutineSettings,
  RoutineTestResult,
  ServedScriptInfo,
  SessionStartDetails,
  SecretSummary,
  SecretEntryChange,
  CreatedSecretEntry,
  NewSecretEntry,
  SessionState,
  SecretTestResult,
  SessionsOverview,
  SessionStart,
  SessionStartSubmission,
  NewIssueRequest,
  CreatedIssue,
  HeadlessPermissionMode,
  StartAttachment,
  StartTarget,
  StartWorkflow,
  StartOptions,
  UsageReport,
  WorkflowSkillsPullRequest,
  WorkflowSkillsStatus,
  VaultState,
} from '@dashi/contracts'

// What an unattended laptop start runs on: the agent's own default (the laptop's Claude login, or OpenCode's
// configured model), or an OpenRouter model on the laptop's own key.
export type StartModelSource = 'default' | 'openrouter'

export interface StartChoices {
  workflow: StartWorkflow
  target: StartTarget | null
  // Read through agentFor: only an unattended laptop start can run OpenCode.
  agent: StartAgent
  permissionMode: HeadlessPermissionMode
  modelSource: StartModelSource
  // As typed; read through openRouterModelFor before it is sent.
  openRouterModel: string
}

export interface PickedAttachment {
  attachment: StartAttachment
  byteSize: number
}

export type RadixColor = 'gray' | 'blue' | 'indigo' | 'amber' | 'red' | 'green' | 'jade' | 'sky' | 'orange' | 'purple'

export type GateRingGroup = 'failure' | 'pending' | 'success' | 'other'

export interface GateRingSegment {
  group: GateRingGroup
  gateCount: number
  startFraction: number
  lengthFraction: number
}

export interface StartTargetAvailability {
  isAvailable: boolean
  hint: string | null
}

export interface ScriptDownloadInput {
  dashboardUrl: string
  scriptPath: string
  fileName: string
  scriptSha256: string
  platform: MachinePlatform
}

export interface RunnerSetupInput {
  dashboardUrl: string
  runnerToken: string
  scriptSha256: string
  platform: MachinePlatform
}

export interface LogoParticle {
  x: number
  y: number
  radius: number
  concentration: number
}

export interface RepositoryWorkflowSkills {
  repository: RepositoryReference
  status: WorkflowSkillsStatus
}

export interface RepositoryBoardCard {
  card: BoardCard
  repository: RepositoryReference
}

export interface RepositoryBoardColumn {
  status: IssueStatus
  cards: RepositoryBoardCard[]
}

export type ToastTone = 'success' | 'error'

export interface ToastMessage {
  toastId: number
  text: string
  tone: ToastTone
}

export interface ToastApi {
  notifySuccess: (text: string) => void
  notifyError: (errorOrText: unknown) => void
}

export interface DashboardApi {
  signInUrl: string
  readSession: () => Promise<SessionState>
  signOut: () => Promise<void>
  readVault: () => Promise<VaultState>
  setUpVault: (passphrase: string) => Promise<VaultState>
  unlockVault: (passphrase: string) => Promise<VaultState>
  lockVault: () => Promise<VaultState>
  listSecrets: () => Promise<SecretSummary[]>
  addSecretEntry: (name: string, newEntry: NewSecretEntry) => Promise<CreatedSecretEntry>
  updateSecretEntry: (name: string, entryId: string, change: SecretEntryChange) => Promise<void>
  useSecretEntry: (name: string, entryId: string) => Promise<void>
  deleteSecretEntry: (name: string, entryId: string) => Promise<void>
  testSecretEntry: (name: string, entryId: string) => Promise<SecretTestResult>
  listRepositories: () => Promise<RepositoryReference[]>
  readBoard: (repository: RepositoryReference, refresh: boolean) => Promise<Board>
  pullRequestMediaUrl: (repository: RepositoryReference, pullRequest: PullRequestSummary, kind: PreviewMediaKind) => string
  mergePullRequest: (repository: RepositoryReference, pullRequest: PullRequestSummary) => Promise<void>
  closePullRequest: (repository: RepositoryReference, pullRequest: PullRequestSummary) => Promise<void>
  setPullRequestDraft: (repository: RepositoryReference, pullRequest: PullRequestSummary, isDraft: boolean) => Promise<void>
  readPullRequestFiles: (repository: RepositoryReference, pullRequest: PullRequestSummary) => Promise<PullRequestFiles>
  readNetlifyStatus: (repository: RepositoryReference) => Promise<NetlifyStatus>
  enableNetlify: (repository: RepositoryReference) => Promise<NetlifyStatus>
  readWorkflowSkills: (repository: RepositoryReference) => Promise<WorkflowSkillsStatus>
  addWorkflowSkills: (repository: RepositoryReference) => Promise<WorkflowSkillsPullRequest>
  readSessions: (hours: number) => Promise<SessionsOverview>
  readSessionChat: (target: ChatTarget) => Promise<SessionChat>
  sendChatMessage: (target: ChatTarget, text: string) => Promise<ChatDelivery>
  readUsage: (days: number) => Promise<UsageReport>
  listMachineTokens: (kind: MachineTokenKind) => Promise<MachineTokenSummary[]>
  createMachineToken: (kind: MachineTokenKind, label: string) => Promise<CreatedMachineToken>
  revokeMachineToken: (kind: MachineTokenKind, tokenId: string) => Promise<void>
  readStartOptions: (repository: RepositoryReference) => Promise<StartOptions>
  listSessionStarts: () => Promise<SessionStart[]>
  startSession: (submission: SessionStartSubmission) => Promise<SessionStart>
  createIssue: (repository: RepositoryReference, newIssue: NewIssueRequest) => Promise<CreatedIssue>
  readSessionStart: (startId: string) => Promise<SessionStartDetails>
  retrySessionStart: (startId: string) => Promise<SessionStart>
  testRoutine: (repository: RepositoryReference) => Promise<RoutineTestResult>
  readRunnerScriptInfo: () => Promise<ServedScriptInfo>
  readCliScriptInfo: () => Promise<ServedScriptInfo>
  describePairing: (userCode: string) => Promise<PairingDescription>
  approvePairing: (approval: PairingApproval) => Promise<void>
  readRoutineSettings: (repository: RepositoryReference) => Promise<RoutineSettings>
  saveRoutineSettings: (repository: RepositoryReference, routineId: string, token: string) => Promise<void>
  deleteRoutineSettings: (repository: RepositoryReference) => Promise<void>
}

export type ChartedSessionState = Extract<AgentSessionState, 'working' | 'waiting' | 'idle'>

export interface TimelineBar {
  barKey: string
  state: ChartedSessionState
  startedAt: string
  endedAt: string
  leftPercent: number
  widthPercent: number
}

export interface TimelineLane {
  sessionId: string
  state: AgentSessionState
  bars: TimelineBar[]
}

export interface TimeTick {
  tickKey: string
  label: string
  leftPercent: number
}

export interface SessionTimelineLayout {
  lanes: TimelineLane[]
  ticks: TimeTick[]
}

export interface ConnectSnippetInput {
  dashboardUrl: string
  ingestToken: string
}

export interface RuntimeConfiguration {
  isDemoMode: boolean
  apiBaseUrl: string
}

export type DemoPullRequestOutcome = 'merged' | 'closed' | 'draft' | 'ready'

export type DiffLineKind = 'hunk' | 'added' | 'removed' | 'context' | 'note'

export interface DiffLine {
  lineKey: string
  kind: DiffLineKind
  oldLineNumber: number | null
  newLineNumber: number | null
  text: string
}

export type ChatTimelineItem = { itemKey: string; source: 'transcript'; message: ChatMessage } | { itemKey: string; source: 'pending'; delivery: ChatDelivery }

// A chat is opened on a session whose hooks report to Dashi, or on a laptop start from the board
// whose Claude session the runner finds from its worktree.
export type ChatTarget = { kind: 'session'; sessionId: string } | { kind: 'start'; startId: string }

export interface ChatSubject {
  target: ChatTarget
  title: string
  detail: string
  badgeLabel: string
  badgeColor: RadixColor
}

export type DataSourceId =
  | 'claude-code-hooks'
  | 'codex-notify'
  | 'opencode-reporter'
  | 'claude-code-otel'
  | 'github-graphql'
  | 'claude-code-routines'
  | 'laptop-runner'
  | 'workflow-status-hook'
  | 'dashi-machine-token'

export interface DataSource {
  label: string
  // What this source sends or answers, and the Dashi route that receives it.
  description: string
  docsUrl: string
}

export interface CredentialDocLink {
  label: string
  url: string
}

export type MachineGuideName = 'machine-setup' | 'connect-claude-code' | 'laptop-runner'

// What Dashi does with a credential, shown under it on the Credentials page.
export interface CredentialGuide {
  isUsedByDashi: boolean
  usedFor: string
  // Each API call Dashi makes with it, method and path first.
  calls: string[]
  permissions: string[]
  docs: CredentialDocLink[]
}
