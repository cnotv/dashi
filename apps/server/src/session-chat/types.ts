import type { z } from 'zod'
import type { AgentSessionState, ChatDelivery, ChatMessage, ChatMessageRole, SessionChat } from '@dashi/contracts'
import type { deliveryReportSchema, runnerChatReportSchema } from './schema.ts'

export type RunnerChatReport = z.infer<typeof runnerChatReportSchema>

export type DeliveryReport = z.infer<typeof deliveryReportSchema>

// A chat opened from a board start names the start; the runner finds its Claude session from the
// start's worktree.
export interface ChatWorkStart {
  repositoryName: string
  startId: string
  target: 'laptop-remote-control' | 'laptop-headless'
}

export interface ChatWorkContext {
  sessionState: AgentSessionState | null
  start: ChatWorkStart | null
  // Set for a cloud session, which the runner sends to with claude --cloud instead of reading.
  cloudSessionId: string | null
}

export interface ChatWorkSession extends ChatWorkContext {
  sessionId: string
}

export interface ChatWorkDelivery extends ChatWorkSession {
  deliveryId: string
  text: string
}

export interface ChatWork {
  sessions: ChatWorkSession[]
  deliveries: ChatWorkDelivery[]
}

export interface TrackedDelivery {
  sessionId: string
  delivery: ChatDelivery
  changedAt: number
}

export interface ChatRelayState {
  watchedUntil: Map<string, number>
  transcripts: Map<string, RunnerChatReport>
  deliveries: Map<string, TrackedDelivery>
}

export interface ChatRelay {
  readChat: (sessionId: string, isRunnerOnline: boolean) => SessionChat
  listDeliveries: (sessionId: string) => ChatDelivery[]
  queueMessage: (sessionId: string, text: string) => ChatDelivery | null
  takeWork: (contextOf: (sessionId: string) => ChatWorkContext) => ChatWork
  recordTranscript: (sessionId: string, report: RunnerChatReport) => boolean
  recordDeliveryReport: (deliveryId: string, report: DeliveryReport) => boolean
}

// One line of a cloud session's conversation, as a hook reported it: what it was asked, or a
// turn's final reply.
export interface CloudHookMessage {
  role: ChatMessageRole
  text: string
}

export interface CloudConversation {
  messages: ChatMessage[]
  updatedAt: number
}

export interface CloudConversationState {
  conversations: Map<string, CloudConversation>
  cloudSessionByHookSession: Map<string, string>
}

export interface CloudConversationStore {
  recordHook: (hookSessionId: string, cloudSessionId: string, message: CloudHookMessage | null) => void
  cloudSessionOf: (hookSessionId: string) => string | null
  readMessages: (cloudSessionId: string) => ChatMessage[]
}
