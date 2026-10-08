import type { z } from 'zod'
import type {
  AgentProvider,
  AgentStatusReport,
  AgentSessionState,
  RepositoryReference,
  SessionStart,
} from '@dashi/contracts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'
import type { CloudHookMessage } from '../session-chat/types.ts'
import type { hookPayloadSchema, keyValueSchema, otlpMetricsSchema } from './schema.ts'

export type HookPayload = z.infer<typeof hookPayloadSchema>
export type OtlpMetricsRequest = z.infer<typeof otlpMetricsSchema>
export type OtlpKeyValue = z.infer<typeof keyValueSchema>

export type TokenType = 'input' | 'output' | 'cacheRead' | 'cacheCreation'

export interface HookHeaders {
  provider: string | undefined
  branch: string | undefined
  remote: string | undefined
  cwd: string | undefined
  launcher: string | undefined
  terminal: string | undefined
  app: string | undefined
  billing: string | undefined
  apiHost: string | undefined
  startId: string | undefined
}

// What started a session and what pays for it, as the status hook reads them from its environment.
export interface SessionOrigin {
  // CLAUDE_CODE_ENTRYPOINT, such as cli, sdk-ts or claude-vscode.
  launcher: string | null
  // TERM_PROGRAM, such as iTerm.app.
  terminal: string | null
  // A macOS bundle id or a process name, such as com.example.CodePilot or iTerm2.
  launchingApp: string | null
  billing: SessionBilling | null
  // The host of ANTHROPIC_BASE_URL, such as openrouter.ai.
  apiHost: string | null
  // Set by Dashi's runner on the sessions it starts from the board.
  startId: string | null
}

export type SessionBilling = 'api-key' | 'bedrock' | 'vertex' | 'foundry' | 'claude-login' | 'chatgpt-login'

export interface AgentEvent {
  sessionId: string
  provider: AgentProvider
  state: AgentSessionState
  repository: RepositoryReference | null
  branch: string | null
  title: string | null
  folder: string | null
  origin: SessionOrigin
  occurredAt: string
}

export interface TokenUsagePoint {
  sessionId: string
  model: string
  tokenType: TokenType
  value: number
  isCumulative: boolean
  seriesStart: string
  observedAt: string
  // The user's email, else `org:` and the organization id; null when nobody is signed in.
  account: string | null
  // `cloud:` and the cloud session id when it runs in Claude's cloud, else the entrypoint, such as cli.
  launchHint: string | null
}

export interface StoredSession {
  sessionId: string
  provider: AgentProvider
  repository: RepositoryReference | null
  branch: string | null
  title: string | null
  folder: string | null
  origin: SessionOrigin
  state: AgentSessionState
  startedAt: string
  lastEventAt: string
}

export interface StoredEvent {
  sessionId: string
  state: AgentSessionState
  occurredAt: string
}

export interface StoredTokenSample {
  sessionId: string
  model: string
  tokenType: TokenType
  tokens: number
  recordedAt: string
  machineTokenId: string | null
  account: string | null
  launchHint: string | null
}

export interface ActivityStore {
  recordEvent: (event: AgentEvent) => void
  recordTokenUsage: (points: TokenUsagePoint[], machineTokenId: string | null) => void
  readSessions: () => StoredSession[]
  readEventsSince: (since: string) => StoredEvent[]
  readTokenSamplesSince: (since: string) => StoredTokenSample[]
}

export interface ActivityDependencies {
  activityStore: ActivityStore
  ingestTokens: MachineTokenStore
  now: () => number
}

// Hands a cloud session's hook to its chat: the session id in the payload, the cloud session it
// runs in, and the prompt or reply it carried.
export type CloudHookRecorder = (hookSessionId: string, cloudSessionId: string, message: CloudHookMessage | null) => void

// Keeps what an agent says about its own start, and tells whether that start exists.
export type AgentStatusRecorder = (startId: string, report: AgentStatusReport) => boolean

export type UsageStart = Pick<SessionStart, 'startId' | 'repository' | 'target' | 'sessionUrl'>

export interface UsageSourceLookups {
  // The label of a machine token, or null once it has been revoked.
  machineLabelOf: (tokenId: string) => string | null
  starts: UsageStart[]
}
