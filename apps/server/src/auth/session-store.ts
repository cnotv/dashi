import { createHash } from 'node:crypto'
import { createRandomToken } from './pkce.ts'
import type { DashboardSession, PendingSignIn, SessionStore } from './types.ts'

const pendingSignInMilliseconds = 10 * 60_000
// Starting a sign-in needs no session, so without a cap anyone could fill the memory with
// pending ones; past the cap the oldest are dropped, which only costs a slow starter a retry.
const maximumPendingSignIns = 1000

// Only a hash of the cookie value is kept as the key, so a heap dump does not hand out
// usable session cookies alongside the tokens.
const hashSessionId = (sessionId: string): string => createHash('sha256').update(sessionId).digest('base64url')

const withoutExpired = <Entry extends { expiresAt: number }>(entries: Map<string, Entry>, now: number): Map<string, Entry> =>
  new Map([...entries].filter(([, entry]) => entry.expiresAt > now))

const newestEntries = <Entry>(entries: Map<string, Entry>, limit: number): Map<string, Entry> =>
  new Map([...entries].slice(-limit))

/**
 * Creates the store of signed-in sessions and pending sign-ins.
 * Sessions live in memory on purpose: no GitHub token is ever written to disk, and a restart
 * costs one click on "Sign in with GitHub", which GitHub completes without a prompt.
 * @param now The clock, injected so tests can move time.
 * @returns The session store.
 */
export const createSessionStore = (now: () => number): SessionStore => {
  const memory = {
    sessions: new Map<string, DashboardSession>(),
    pendingSignIns: new Map<string, PendingSignIn>(),
  }

  return {
    createSession: (user, credentials, expiresAt) => {
      const sessionId = createRandomToken()
      memory.sessions = withoutExpired(memory.sessions, now()).set(hashSessionId(sessionId), { user, ...credentials, expiresAt })
      return sessionId
    },
    readSession: (sessionId) => {
      if (sessionId === undefined) return null
      const session = memory.sessions.get(hashSessionId(sessionId))
      return session !== undefined && session.expiresAt > now() ? session : null
    },
    replaceCredentials: (sessionId, credentials, expiresAt) => {
      if (sessionId === undefined) return
      const key = hashSessionId(sessionId)
      const session = memory.sessions.get(key)
      if (session !== undefined) memory.sessions.set(key, { ...session, ...credentials, expiresAt })
    },
    removeSession: (sessionId) => {
      if (sessionId !== undefined) memory.sessions.delete(hashSessionId(sessionId))
    },
    createPendingSignIn: (codeVerifier) => {
      const state = createRandomToken()
      memory.pendingSignIns = newestEntries(withoutExpired(memory.pendingSignIns, now()), maximumPendingSignIns - 1).set(state, {
        codeVerifier,
        expiresAt: now() + pendingSignInMilliseconds,
      })
      return state
    },
    takePendingSignIn: (state) => {
      if (state === undefined) return null
      const pendingSignIn = memory.pendingSignIns.get(state)
      memory.pendingSignIns.delete(state)
      return pendingSignIn !== undefined && pendingSignIn.expiresAt > now() ? pendingSignIn : null
    },
  }
}
