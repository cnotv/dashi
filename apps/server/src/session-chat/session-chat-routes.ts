import { Hono, type Context } from 'hono'
import type { SessionChat, SessionStart } from '@dashi/contracts'
import { effectiveState } from '../activity/aggregate.ts'
import type { ActivityStore } from '../activity/types.ts'
import { limitTo, readJsonBody } from '../app/http.ts'
import type { AppEnvironment } from '../app/types.ts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'
import { createRedactor } from '../secrets/redact.ts'
import type { Vault } from '../secrets/types.ts'
import { createRunnerTokenGuard, isAnyRunnerOnline } from '../session-starts/session-start-routes.ts'
import type { SessionStartStore } from '../session-starts/types.ts'
import { cloudSessionIdOfUrl, isCloudChatId } from './cloud-conversations.ts'
import { chatMessageBodySchema, deliveryReportSchema, runnerChatReportSchema, sessionIdSchema, startIdSchema } from './schema.ts'
import type { ChatRelay, ChatWorkContext, ChatWorkStart, CloudConversationStore } from './types.ts'

export interface SessionChatRouteDependencies {
  chatRelay: ChatRelay
  cloudConversations: CloudConversationStore
  activityStore: ActivityStore
  runnerTokens: MachineTokenStore
  startStore: SessionStartStore
  vault: Vault
  now: () => number
}

const unknownSessionError = { error: 'Unknown session' }
const startChatIdPrefix = 'start-'

const chatStartOf = (start: SessionStart): ChatWorkStart | null =>
  start.target === 'laptop-remote-control' || start.target === 'laptop-headless'
    ? { repositoryName: start.repository.name, startId: start.startId, target: start.target }
    : null

const findRecentStart = (startStore: SessionStartStore, startId: string): SessionStart | undefined =>
  startStore.listRecentStarts().find((recentStart) => recentStart.startId === startId)

const findLaptopStart = (startStore: SessionStartStore, startId: string): ChatWorkStart | null => {
  const start = findRecentStart(startStore, startId)
  return start === undefined ? null : chatStartOf(start)
}

// A cloud start is chatted with under its cloud session's id, known once claude.ai gave its link.
const cloudSessionOfStart = (start: SessionStart | undefined): string | null =>
  start === undefined || (start.target !== 'cloud-routine' && start.target !== 'laptop-cloud') ? null : cloudSessionIdOfUrl(start.sessionUrl)

const offlineRunnerBlocker = 'Messages reach a cloud session through the laptop runner, which is offline; start it under Credentials'

const cloudChatOf = (
  cloudSessionId: string,
  { chatRelay, cloudConversations }: Pick<SessionChatRouteDependencies, 'chatRelay' | 'cloudConversations'>,
  isRunnerOnline: boolean,
): SessionChat => ({
  sessionId: cloudSessionId,
  availability: 'in-cloud',
  deliveryRoute: isRunnerOnline ? 'cloud' : 'none',
  sendBlocker: isRunnerOnline ? null : offlineRunnerBlocker,
  messages: cloudConversations.readMessages(cloudSessionId),
  deliveries: chatRelay.listDeliveries(cloudSessionId),
  updatedAt: null,
})

/**
 * Builds the chat drawer's routes, for a session by its id or for a start from the board: reading
 * its conversation, and queueing a message for the runner to deliver. A laptop session's
 * conversation is the transcript the runner sends while the drawer is open; a cloud session's is
 * what its hooks reported.
 * @param dependencies The relay, the cloud conversations, the starts, and the runner tokens that tell whether a laptop is online.
 * @returns The routes, mounted under /api.
 */
export const createSessionChatRoutes = (dependencies: SessionChatRouteDependencies) => {
  const { chatRelay, cloudConversations, runnerTokens, startStore, now } = dependencies
  const routes = new Hono<AppEnvironment>()

  // A session whose hooks said it runs in the cloud is chatted with as that cloud session.
  const sessionChatIdOf = (context: Context<AppEnvironment>): string | null => {
    const parsedSessionId = sessionIdSchema.safeParse(context.req.param('sessionId'))
    if (!parsedSessionId.success || parsedSessionId.data.startsWith(startChatIdPrefix)) return null
    return cloudConversations.cloudSessionOf(parsedSessionId.data) ?? parsedSessionId.data
  }
  // A laptop start is chatted with under its own id until its Claude session is known, since the
  // runner finds its transcript from the start's worktree.
  const startChatIdOf = (context: Context<AppEnvironment>): string | null => {
    const parsedStartId = startIdSchema.safeParse(context.req.param('startId'))
    if (!parsedStartId.success) return null
    const cloudSessionId = cloudSessionOfStart(findRecentStart(startStore, parsedStartId.data))
    if (cloudSessionId !== null) return cloudSessionId
    return findLaptopStart(startStore, parsedStartId.data) === null ? null : `${startChatIdPrefix}${parsedStartId.data}`
  }

  const addChatRoutes = (path: string, chatIdOf: (context: Context<AppEnvironment>) => string | null): void => {
    routes.get(path, (context) => {
      const chatId = chatIdOf(context)
      if (chatId === null) return context.json(unknownSessionError, 404)
      const isRunnerOnline = isAnyRunnerOnline(runnerTokens, now())
      return context.json(isCloudChatId(chatId) ? cloudChatOf(chatId, dependencies, isRunnerOnline) : chatRelay.readChat(chatId, isRunnerOnline))
    })

    routes.post(path, limitTo(16 * 1024), async (context) => {
      const chatId = chatIdOf(context)
      if (chatId === null) return context.json(unknownSessionError, 404)
      const { text } = chatMessageBodySchema.parse(await readJsonBody(context.req.raw))
      const delivery = chatRelay.queueMessage(chatId, text)
      return delivery === null
        ? context.json({ error: 'Too many messages are still waiting for the laptop runner' }, 429)
        : context.json(delivery, 201)
    })
  }

  addChatRoutes('/sessions/:sessionId/chat', sessionChatIdOf)
  addChatRoutes('/session-starts/:startId/chat', startChatIdOf)

  return routes
}

/**
 * Builds the runner's side of the chat: which sessions to read and which messages to deliver,
 * and the transcripts and delivery results it sends back. Transcripts are scrubbed of every
 * stored secret before the relay holds them.
 * @param dependencies The relay, the activity store for each session's state, the starts, the runner tokens and the vault.
 * @returns The routes, mounted under /api/runner.
 */
export const createRunnerChatRoutes = ({
  chatRelay,
  activityStore,
  runnerTokens,
  startStore,
  vault,
  now,
}: SessionChatRouteDependencies) => {
  const routes = new Hono<AppEnvironment & { Variables: { runnerLabel: string } }>()
  const requireRunnerToken = createRunnerTokenGuard(runnerTokens)

  const contextOf = (chatId: string): ChatWorkContext => {
    if (isCloudChatId(chatId)) return { sessionState: null, start: null, cloudSessionId: chatId }
    if (chatId.startsWith(startChatIdPrefix)) {
      return { sessionState: null, start: findLaptopStart(startStore, chatId.slice(startChatIdPrefix.length)), cloudSessionId: null }
    }
    const storedSession = activityStore.readSessions().find((session) => session.sessionId === chatId)
    return { sessionState: storedSession === undefined ? null : effectiveState(storedSession, now()), start: null, cloudSessionId: null }
  }

  routes.post('/chat-work', requireRunnerToken, (context) => context.json(chatRelay.takeWork(contextOf)))

  routes.post('/chat/:sessionId', requireRunnerToken, limitTo(1024 * 1024), async (context) => {
    const parsedSessionId = sessionIdSchema.safeParse(context.req.param('sessionId'))
    if (!parsedSessionId.success) return context.json(unknownSessionError, 404)
    const report = runnerChatReportSchema.parse(await readJsonBody(context.req.raw))
    const redact = createRedactor(vault.readAllSecretValues())
    const scrubbedReport = { ...report, messages: report.messages.map((message) => ({ ...message, text: redact(message.text) })) }
    return chatRelay.recordTranscript(parsedSessionId.data, scrubbedReport)
      ? context.body(null, 204)
      : context.json({ error: 'Nobody is reading that session' }, 404)
  })

  routes.post('/deliveries/:deliveryId', requireRunnerToken, limitTo(16 * 1024), async (context) => {
    const report = deliveryReportSchema.parse(await readJsonBody(context.req.raw))
    return chatRelay.recordDeliveryReport(context.req.param('deliveryId'), report)
      ? context.body(null, 204)
      : context.json({ error: 'No message is waiting for that report' }, 404)
  })

  return routes
}
