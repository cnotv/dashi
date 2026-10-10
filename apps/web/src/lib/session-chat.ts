import type { AgentSessionSummary, ChatDelivery, ChatMessage, SessionChat, SessionStart } from '@dashi/contracts'
import { sessionStartStateColors, sessionStartStateLabels, sessionStateColors, sessionStateLabels, startTargetLabels } from './presentation'
import { sessionDetail, sessionLabel } from './session-timeline'
import type { ChatSubject, ChatTarget, ChatTimelineItem } from './types'

// The laptop's clock and the server's can disagree by a little, so a transcript message counts
// as the delivered one when it is at most this much older than the delivery.
const clockSkewMilliseconds = 60_000

const isInTranscript = (delivery: ChatDelivery, messages: ChatMessage[]): boolean =>
  messages.some(
    (message) =>
      message.role === 'user' &&
      message.kind === 'text' &&
      message.text.trim() === delivery.text.trim() &&
      (message.createdAt === null || Date.parse(message.createdAt) >= Date.parse(delivery.createdAt) - clockSkewMilliseconds),
  )

/**
 * Lays out a session's chat: the transcript, then every message typed in Dashi that the
 * transcript does not show yet, so a message stays visible from the moment it is sent.
 * @param chat The session's chat from the server.
 * @returns The items in the order the drawer shows them.
 */
export const chatTimelineOf = (chat: SessionChat): ChatTimelineItem[] => [
  ...chat.messages.map((message): ChatTimelineItem => ({ itemKey: message.messageId, source: 'transcript', message })),
  ...chat.deliveries
    .filter((delivery) => !(delivery.state === 'delivered' && isInTranscript(delivery, chat.messages)))
    .map((delivery): ChatTimelineItem => ({ itemKey: delivery.deliveryId, source: 'pending', delivery })),
]

/**
 * Names a chat for caching and polling, distinct for a session and a start.
 * @param target The session or start the chat belongs to.
 * @returns The key.
 */
export const chatKeyOf = (target: ChatTarget): string =>
  target.kind === 'session' ? `session-${target.sessionId}` : `start-${target.startId}`

/**
 * The drawer heading for a session from the sessions table.
 * @param session The session.
 * @returns Its chat subject.
 */
export const chatSubjectOfSession = (session: AgentSessionSummary): ChatSubject => ({
  target: { kind: 'session', sessionId: session.sessionId },
  title: sessionLabel(session),
  detail: sessionDetail(session),
  badgeLabel: sessionStateLabels[session.state],
  badgeColor: sessionStateColors[session.state],
})

const cloudSessionLinkPattern = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/

/**
 * Tells whether a start from the board has a chat: one Claude Code runs that has started, on the
 * laptop, or in the cloud once claude.ai has given its session's link.
 * @param start The start.
 * @returns True when Dashi can show its conversation and send to it.
 */
export const canChatWithStart = (start: SessionStart): boolean => {
  if (start.state !== 'started' || start.agent !== 'claude') return false
  if (start.target === 'laptop-remote-control' || start.target === 'laptop-headless') return true
  return start.sessionUrl !== null && cloudSessionLinkPattern.test(start.sessionUrl)
}

/**
 * Tells whether a reporting session has a chat: Claude Code's conversation is a transcript the
 * runner reads, or a cloud session's hooks; Codex and OpenCode keep theirs where Dashi cannot.
 * @param session The session, by the agent that runs it.
 * @param session.provider The agent.
 * @returns True for a Claude Code session.
 */
export const canChatWithSession = ({ provider }: Pick<AgentSessionSummary, 'provider'>): boolean => provider === 'claude'

/**
 * The drawer heading for a start from the board.
 * @param start The start.
 * @returns Its chat subject.
 */
export const chatSubjectOfStart = (start: SessionStart): ChatSubject => ({
  target: { kind: 'start', startId: start.startId },
  title: `${start.repository.name}${start.issueNumber === null ? '' : ` #${start.issueNumber}`} · ${start.workflow}`,
  detail: startTargetLabels[start.target].name,
  badgeLabel: sessionStartStateLabels[start.state],
  badgeColor: sessionStartStateColors[start.state],
})
