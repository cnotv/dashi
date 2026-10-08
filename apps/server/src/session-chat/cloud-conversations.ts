import type { ChatMessage } from '@dashi/contracts'
import { chatMessageCountLimit, chatMessageTextLimit } from './schema.ts'
import type { CloudConversation, CloudConversationState, CloudConversationStore, CloudHookMessage } from './types.ts'

// Enough for every cloud session a person keeps an eye on; the least recently heard is dropped first.
const conversationLimit = 200

// The hooks send cse_<id>, a start's link ends in session_<id>: the same session.
const cloudSessionIdPattern = /^(?:cse|session)_([A-Za-z0-9]{1,100})$/
const sessionLinkPattern = /^https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{1,100})(?:[/?#].*)?$/

/**
 * Reads the cloud session a hook reported it runs in.
 * @param value The X-Agent-Cloud-Session header, CLAUDE_CODE_REMOTE_SESSION_ID in the session.
 * @returns The id as session_<id>, or null outside the cloud or for anything malformed.
 */
export const cloudSessionIdOf = (value: string | undefined): string | null => {
  const idMatch = cloudSessionIdPattern.exec(value?.trim() ?? '')
  return idMatch?.[1] === undefined ? null : `session_${idMatch[1]}`
}

/**
 * Reads the cloud session behind a claude.ai session link, such as a routine start's.
 * @param sessionUrl The link.
 * @returns The id as session_<id>, or null for any other link.
 */
export const cloudSessionIdOfUrl = (sessionUrl: string | null): string | null =>
  sessionUrl === null ? null : (sessionLinkPattern.exec(sessionUrl)?.[1] ?? null)

/**
 * Tells a chat on a cloud session from one on a laptop session, whose ids are UUIDs.
 * @param chatId The chat's id.
 * @returns True for a cloud session's id.
 */
export const isCloudChatId = (chatId: string): boolean => /^session_[A-Za-z0-9]{1,100}$/.test(chatId)

const clippedText = (text: string): string => (text.length > chatMessageTextLimit ? `${text.slice(0, chatMessageTextLimit)}…` : text)

const withConversation = (state: CloudConversationState, cloudSessionId: string, conversation: CloudConversation): CloudConversationState => {
  const others = [...state.conversations].filter(([listedId]) => listedId !== cloudSessionId)
  const kept = others.sort(([, first], [, second]) => second.updatedAt - first.updatedAt).slice(0, conversationLimit - 1)
  const keptIds = new Set([cloudSessionId, ...kept.map(([listedId]) => listedId)])
  return {
    conversations: new Map([...kept, [cloudSessionId, conversation]]),
    cloudSessionByHookSession: new Map([...state.cloudSessionByHookSession].filter(([, listedId]) => keptIds.has(listedId))),
  }
}

/**
 * Adds what one hook said to a cloud session's conversation, and remembers which cloud session the
 * hook's own session id belongs to.
 * @param state The conversations so far.
 * @param hookSessionId The session id in the hook's payload.
 * @param cloudSessionId The cloud session it runs in.
 * @param message The prompt or reply it carried, if any.
 * @param now The current time in milliseconds.
 * @returns The new state, holding at most the last messages of the most recently heard sessions.
 */
export const recordCloudHook = (
  state: CloudConversationState,
  hookSessionId: string,
  cloudSessionId: string,
  message: CloudHookMessage | null,
  now: number,
): CloudConversationState => {
  const previousMessages = state.conversations.get(cloudSessionId)?.messages ?? []
  const createdAt = new Date(now).toISOString()
  const addedMessages: ChatMessage[] =
    message === null || message.text.trim() === ''
      ? []
      : [{ messageId: `${cloudSessionId}-${previousMessages.length}-${now}`, role: message.role, kind: 'text', text: clippedText(message.text), toolName: null, createdAt }]
  const withMessages = withConversation(state, cloudSessionId, {
    messages: [...previousMessages, ...addedMessages].slice(-chatMessageCountLimit),
    updatedAt: now,
  })
  return { ...withMessages, cloudSessionByHookSession: new Map([...withMessages.cloudSessionByHookSession, [hookSessionId, cloudSessionId]]) }
}

/**
 * Creates the store of cloud sessions' conversations, fed by their hooks. Like the laptop
 * transcripts it lives only in memory: a restart of Dashi starts every conversation afresh.
 * @param now The clock, injected so tests can move it.
 * @returns The store.
 */
export const createCloudConversationStore = (now: () => number): CloudConversationStore => {
  const store: { state: CloudConversationState } = { state: { conversations: new Map(), cloudSessionByHookSession: new Map() } }
  return {
    recordHook: (hookSessionId, cloudSessionId, message) => {
      store.state = recordCloudHook(store.state, hookSessionId, cloudSessionId, message, now())
    },
    cloudSessionOf: (hookSessionId) => store.state.cloudSessionByHookSession.get(hookSessionId) ?? null,
    readMessages: (cloudSessionId) => store.state.conversations.get(cloudSessionId)?.messages ?? [],
  }
}
