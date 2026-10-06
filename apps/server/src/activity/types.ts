import type { z } from 'zod'
import type {
  AgentProvider,
  AgentSessionState,
  RepositoryReference,
  SessionStart,
} from '@dashi/contracts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'
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
}

export interface AgentEvent {
  sessionId: string
  provider: AgentProvider
  state: AgentSessionState
  repository: RepositoryReference | null
  branch: string | null
  title: string | null
  folder: string | null
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

export type UsageStart = Pick<SessionStart, 'startId' | 'repository' | 'target' | 'sessionUrl'>

export interface UsageSourceLookups {
  // The label of a machine token, or null once it has been revoked.
  machineLabelOf: (tokenId: string) => string | null
  starts: UsageStart[]
}
