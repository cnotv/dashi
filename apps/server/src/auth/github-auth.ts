import { z } from 'zod'
import { codeChallengeFor } from './pkce.ts'
import type { GitHubAuthClient, GitHubSignInSettings, GitHubUserToken } from './types.ts'

const githubAuthorizeUrl = 'https://github.com/login/oauth/authorize'
const githubTokenUrl = 'https://github.com/login/oauth/access_token'
const githubUserUrl = 'https://api.github.com/user'

const tokenResponseSchema = z.union([
  z.object({
    access_token: z.string().min(1),
    expires_in: z.number().optional(),
    refresh_token: z.string().min(1).optional(),
    refresh_token_expires_in: z.number().optional(),
  }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
])

const userResponseSchema = z.object({ login: z.string().min(1), avatar_url: z.string() })

const requestUserToken = async (fetchResource: typeof fetch, body: Record<string, string>): Promise<GitHubUserToken> => {
  const tokenResponse = await fetchResource(githubTokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'dashi' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!tokenResponse.ok) throw new Error(`GitHub answered ${tokenResponse.status} to the token request`)
  const parsedToken = tokenResponseSchema.parse(await tokenResponse.json())
  if ('error' in parsedToken) throw new Error(`GitHub refused the token request: ${parsedToken.error_description ?? parsedToken.error}`)
  return {
    accessToken: parsedToken.access_token,
    expiresInSeconds: parsedToken.expires_in ?? null,
    refreshToken: parsedToken.refresh_token ?? null,
    refreshTokenExpiresInSeconds: parsedToken.refresh_token_expires_in ?? null,
  }
}

/**
 * Builds the GitHub address that starts a sign-in, carrying the PKCE challenge and the state.
 * @param settings The GitHub App's client id and callback address.
 * @param state The one-time value the callback must return.
 * @param codeVerifier The PKCE secret whose SHA-256 challenge is sent.
 * @returns The authorize URL to redirect the browser to.
 */
export const buildAuthorizeUrl = (settings: GitHubSignInSettings, state: string, codeVerifier: string): string => {
  const authorizeUrl = new URL(githubAuthorizeUrl)
  authorizeUrl.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.callbackUrl,
    state,
    code_challenge: codeChallengeFor(codeVerifier),
    code_challenge_method: 'S256',
  }).toString()
  return authorizeUrl.toString()
}

/**
 * Tells whether a GitHub login is on the allowlist, ignoring case as GitHub does.
 * @param login The login GitHub returned.
 * @param allowedLogins The logins from DASHI_ALLOWED_USERS.
 * @returns True when the login may sign in.
 */
export const isAllowedLogin = (login: string, allowedLogins: string[]): boolean =>
  allowedLogins.some((allowedLogin) => allowedLogin.toLowerCase() === login.toLowerCase())

/**
 * Creates the client that trades a sign-in code for a user token and reads the signed-in user.
 * @param settings The GitHub App's client id, secret and callback address.
 * @param fetchResource The fetch to use; injected so tests need no network.
 * @returns The auth client.
 */
export const createGitHubAuthClient = (settings: GitHubSignInSettings, fetchResource: typeof fetch = fetch): GitHubAuthClient => ({
  exchangeCode: (code, codeVerifier) =>
    requestUserToken(fetchResource, {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: settings.callbackUrl,
      code_verifier: codeVerifier,
    }),
  refreshToken: (refreshToken) =>
    requestUserToken(fetchResource, {
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  readUser: async (accessToken) => {
    const userResponse = await fetchResource(githubUserUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dashi' },
      signal: AbortSignal.timeout(15000),
    })
    if (!userResponse.ok) throw new Error(`GitHub answered ${userResponse.status} when reading the signed-in user`)
    const { login, avatar_url } = userResponseSchema.parse(await userResponse.json())
    return { login, avatarUrl: avatar_url }
  },
})
