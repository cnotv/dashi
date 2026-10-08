import type { GitHubAuthClient, GitHubUserToken, SessionCredentials, SessionStore } from './types.ts'

const accessTokenCapMilliseconds = 8 * 60 * 60_000
// A refreshed session keeps sliding forward, so this only bounds how long an unused one lingers.
const refreshableSessionCapMilliseconds = 30 * 24 * 60 * 60_000
const refreshMarginMilliseconds = 5 * 60_000

/**
 * Turns the token GitHub returned into what a session stores and how long the session lives.
 * A session with a refresh token outlives the 8-hour access token; one without never outlives it.
 * @param userToken The token from the code exchange or a refresh.
 * @param now The current time in milliseconds.
 * @returns The credentials, the session expiry and the cookie lifetime.
 */
export const credentialsFromUserToken = (
  userToken: GitHubUserToken,
  now: number,
): { credentials: SessionCredentials; expiresAt: number; lifetimeMilliseconds: number } => {
  const tokenLifetime = Math.min(accessTokenCapMilliseconds, (userToken.expiresInSeconds ?? Infinity) * 1000)
  const lifetimeMilliseconds =
    userToken.refreshToken === null
      ? tokenLifetime
      : Math.min(refreshableSessionCapMilliseconds, (userToken.refreshTokenExpiresInSeconds ?? Infinity) * 1000)
  return {
    credentials: { githubToken: userToken.accessToken, refreshToken: userToken.refreshToken, tokenExpiresAt: now + tokenLifetime },
    expiresAt: now + lifetimeMilliseconds,
    lifetimeMilliseconds,
  }
}

/**
 * Creates the function that swaps a session's expiring GitHub token for a fresh one.
 * Refresh tokens are single use, so concurrent requests of one session share one refresh.
 * @param sessionStore Where the renewed credentials are written.
 * @param client The GitHub auth client that performs the refresh.
 * @param now The clock.
 * @returns A function resolving to the cookie lifetime when the session was renewed, else null.
 */
export const createSessionRenewer = (sessionStore: SessionStore, client: GitHubAuthClient, now: () => number) => {
  const inFlight = new Map<string, Promise<number | null>>()

  const renew = async (sessionId: string, refreshToken: string): Promise<number | null> => {
    const renewed = credentialsFromUserToken(await client.refreshToken(refreshToken), now())
    sessionStore.replaceCredentials(sessionId, renewed.credentials, renewed.expiresAt)
    return renewed.lifetimeMilliseconds
  }

  return (sessionId: string): Promise<number | null> => {
    const session = sessionStore.readSession(sessionId)
    if (session === null || session.refreshToken === null || session.tokenExpiresAt - now() > refreshMarginMilliseconds) {
      return Promise.resolve(null)
    }
    const running = inFlight.get(sessionId)
    if (running !== undefined) return running
    // A failed refresh leaves the session to expire with its token rather than signing out early.
    const started = renew(sessionId, session.refreshToken)
      .catch(() => null)
      .finally(() => inFlight.delete(sessionId))
    inFlight.set(sessionId, started)
    return started
  }
}
