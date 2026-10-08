import type { SignedInUser } from '@dashi/contracts'

export interface GitHubSignInSettings {
  clientId: string
  clientSecret: string
  callbackUrl: string
  allowedLogins: string[]
}

export interface SessionCredentials {
  githubToken: string
  // Null when the GitHub App does not expire user tokens, so there is nothing to renew.
  refreshToken: string | null
  tokenExpiresAt: number
}

export interface DashboardSession extends SessionCredentials {
  user: SignedInUser
  expiresAt: number
}

export interface PendingSignIn {
  codeVerifier: string
  expiresAt: number
}

export interface SessionStore {
  createSession: (user: SignedInUser, credentials: SessionCredentials, expiresAt: number) => string
  replaceCredentials: (sessionId: string | undefined, credentials: SessionCredentials, expiresAt: number) => void
  readSession: (sessionId: string | undefined) => DashboardSession | null
  removeSession: (sessionId: string | undefined) => void
  createPendingSignIn: (codeVerifier: string) => string
  takePendingSignIn: (state: string | undefined) => PendingSignIn | null
}

export interface GitHubUserToken {
  accessToken: string
  expiresInSeconds: number | null
  refreshToken: string | null
  refreshTokenExpiresInSeconds: number | null
}

export interface GitHubAuthClient {
  exchangeCode: (code: string, codeVerifier: string) => Promise<GitHubUserToken>
  refreshToken: (refreshToken: string) => Promise<GitHubUserToken>
  readUser: (accessToken: string) => Promise<SignedInUser>
}

export interface GitHubSignIn {
  settings: GitHubSignInSettings
  client: GitHubAuthClient
}

export interface AuthDependencies {
  sessionStore: SessionStore
  githubSignIn: GitHubSignIn | null
  signInRequired: boolean
  secureCookies: boolean
  now: () => number
}

export interface AuthCookieNames {
  session: string
  pendingSignIn: string
}

export type SignInFailure = 'expired' | 'not-allowed' | 'failed'
