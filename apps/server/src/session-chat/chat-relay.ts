import { randomUUID } from 'node:crypto'
import type { ChatDelivery, SessionChat } from '@dashi/contracts'
import type { ChatRelay, ChatRelayState, RunnerChatReport, TrackedDelivery } from './types.ts'

// The drawer asks every few seconds, so a session nobody has asked about for this long has had
// its drawer closed, and its transcript is dropped from memory.
const watchMilliseconds = 20_000
const unconfirmedDeliveryMilliseconds = 120_000
const settledDeliveryMilliseconds = 60_000
const queuedMessageLimit = 10

const withEntry = <Key, Value>(map: Map<Key, Value>, key: Key, value: Value): Map<Key, Value> => new Map([...map, [key, value]])

const withoutEntries = <Key, Value>(map: Map<Key, Value>, keepEntry: (key: Key, value: Value) => boolean): Map<Key, Value> =>
  new Map([...map].filter(([key, value]) => keepEntry(key, value)))

const settle = (tracked: TrackedDelivery, state: 'delivered' | 'failed', message: string | null, now: number): TrackedDelivery => ({
  ...tracked,
  delivery: { ...tracked.delivery, state, message },
  changedAt: now,
})

// A message the runner never picked up, or took and never confirmed, is failed rather than left
// spinning; a settled one stays long enough for the drawer to show how it ended.
const ageDelivery = (tracked: TrackedDelivery, now: number): TrackedDelivery | null => {
  const age = now - tracked.changedAt
  if (tracked.delivery.state === 'queued' && age > unconfirmedDeliveryMilliseconds)
    return settle(tracked, 'failed', 'No runner picked it up', now)
  if (tracked.delivery.state === 'sent' && age > unconfirmedDeliveryMilliseconds)
    return settle(tracked, 'failed', 'The runner did not confirm it', now)
  if ((tracked.delivery.state === 'delivered' || tracked.delivery.state === 'failed') && age > settledDeliveryMilliseconds) return null
  return tracked
}

/**
 * Drops what no open drawer needs any more and ages the pending messages.
 * @param state The relay's state.
 * @param now The current time in milliseconds.
 * @returns The state without expired watches, their transcripts, or finished deliveries.
 */
export const pruneRelayState = (state: ChatRelayState, now: number): ChatRelayState => {
  const watchedUntil = withoutEntries(state.watchedUntil, (_sessionId, until) => until > now)
  return {
    watchedUntil,
    transcripts: withoutEntries(state.transcripts, (sessionId) => watchedUntil.has(sessionId)),
    deliveries: new Map(
      [...state.deliveries].flatMap(([deliveryId, tracked]) => {
        const aged = ageDelivery(tracked, now)
        return aged === null ? [] : [[deliveryId, aged] as const]
      }),
    ),
  }
}

const availabilityOf = (transcript: RunnerChatReport | undefined, isRunnerOnline: boolean): SessionChat['availability'] => {
  if (transcript !== undefined) return transcript.found ? 'on-laptop' : 'not-on-laptop'
  return isRunnerOnline ? 'waiting-for-runner' : 'runner-offline'
}

/**
 * Creates the relay between the chat drawer and the laptop runner. Everything lives in this
 * closure: a transcript is kept only while its drawer is open, and nothing is written to disk.
 * @param now The clock, injected so tests can move it.
 * @returns The relay.
 */
export const createChatRelay = (now: () => number): ChatRelay => {
  const relay: { state: ChatRelayState } = { state: { watchedUntil: new Map(), transcripts: new Map(), deliveries: new Map() } }
  const update = (change: (state: ChatRelayState) => ChatRelayState): ChatRelayState => {
    relay.state = change(pruneRelayState(relay.state, now()))
    return relay.state
  }
  const deliveriesOf = (state: ChatRelayState, sessionId: string): ChatDelivery[] =>
    [...state.deliveries.values()]
      .filter((tracked) => tracked.sessionId === sessionId)
      .map((tracked) => tracked.delivery)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))

  return {
    readChat: (sessionId, isRunnerOnline) => {
      const state = update((current) => ({
        ...current,
        watchedUntil: withEntry(current.watchedUntil, sessionId, now() + watchMilliseconds),
      }))
      const transcript = state.transcripts.get(sessionId)
      return {
        sessionId,
        availability: availabilityOf(transcript, isRunnerOnline),
        deliveryRoute: transcript?.deliveryRoute ?? 'none',
        sendBlocker: transcript === undefined ? 'Waiting for the laptop' : transcript.sendBlocker,
        messages: transcript?.messages ?? [],
        deliveries: deliveriesOf(state, sessionId),
        updatedAt: transcript === undefined ? null : new Date(now()).toISOString(),
      }
    },

    listDeliveries: (sessionId) => deliveriesOf(update((current) => current), sessionId),

    queueMessage: (sessionId, text) => {
      const pendingCount = deliveriesOf(pruneRelayState(relay.state, now()), sessionId).filter(
        (delivery) => delivery.state === 'queued',
      ).length
      if (pendingCount >= queuedMessageLimit) return null
      const delivery: ChatDelivery = {
        deliveryId: randomUUID(),
        text,
        state: 'queued',
        message: null,
        createdAt: new Date(now()).toISOString(),
      }
      update((current) => ({
        ...current,
        deliveries: withEntry(current.deliveries, delivery.deliveryId, { sessionId, delivery, changedAt: now() }),
      }))
      return delivery
    },

    takeWork: (contextOf) => {
      const before = pruneRelayState(relay.state, now())
      const queued = [...before.deliveries.values()].filter((tracked) => tracked.delivery.state === 'queued')
      const state = update((current) => ({
        ...current,
        deliveries: new Map(
          [...current.deliveries].map(([deliveryId, tracked]) =>
            tracked.delivery.state === 'queued'
              ? [deliveryId, { ...tracked, delivery: { ...tracked.delivery, state: 'sent' as const }, changedAt: now() }]
              : [deliveryId, tracked],
          ),
        ),
      }))
      return {
        sessions: [...state.watchedUntil.keys()].map((sessionId) => ({ sessionId, ...contextOf(sessionId) })),
        deliveries: queued.map((tracked) => ({
          deliveryId: tracked.delivery.deliveryId,
          sessionId: tracked.sessionId,
          text: tracked.delivery.text,
          ...contextOf(tracked.sessionId),
        })),
      }
    },

    recordTranscript: (sessionId, report) => {
      if (!pruneRelayState(relay.state, now()).watchedUntil.has(sessionId)) return false
      update((current) => ({ ...current, transcripts: withEntry(current.transcripts, sessionId, report) }))
      return true
    },

    recordDeliveryReport: (deliveryId, report) => {
      const tracked = pruneRelayState(relay.state, now()).deliveries.get(deliveryId)
      if (tracked === undefined || tracked.delivery.state !== 'sent') return false
      update((current) => ({
        ...current,
        deliveries: withEntry(current.deliveries, deliveryId, settle(tracked, report.state, report.message, now())),
      }))
      return true
    },
  }
}
