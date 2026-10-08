import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { SessionState } from '@dashi/contracts'
import type { AppEnvironment } from '../app/types.ts'
import { buildAuthorizeUrl, isAllowedLogin } from './github-auth.ts'
import { createRandomToken } from './pkce.ts'
import { credentialsFromUserToken } from './session-credentials.ts'
import type { AuthCookieNames, AuthDependencies, GitHubSignIn, SignInFailure } from './types.ts'

const pendingSignInSeconds = 10 * 60

/**
 * Names the session and pending sign-in cookies for this deployment.
 * The __Host- prefix makes the browser refuse the cookie unless it is Secure, host-only and
 * path-wide, so a sibling subdomain cannot plant or read it. Plain http on localhost cannot
 * carry a Secure cookie in every browser, so local runs go without the prefix.
 * @param secureCookies Whether the dashboard is served over https.
 * @returns The two cookie names.
 */
export const authCookieNamesFor = (secureCookies: boolean): AuthCookieNames => {
  const prefix = secureCookies ? '__Host-' : ''
  return { session: `${prefix}dashi_session`, pendingSignIn: `${prefix}dashi_sign_in` }
}

/**
 * The attributes every session cookie carries.
 * @param secureCookies Whether the dashboard is served over https.
 * @returns The cookie options.
 */
export const cookieOptionsFor = (secureCookies: boolean) =>
  ({ httpOnly: true, secure: secureCookies, sameSite: 'Lax', path: '/' }) as const

export const publicApiPaths = ['/api/health', '/api/auth/session', '/api/auth/github/start', '/api/auth/github/callback']

const signInFailedPath = (failure: SignInFailure): string => `/?sign-in-error=${failure}`

/**
 * Builds the /api/auth routes: the session read, the GitHub sign-in start and callback, and sign-out.
 * @returns The routes, mounted under /api/auth.
 */
export const createAuthRoutes = ({ sessionStore, githubSignIn, signInRequired, secureCookies, now }: AuthDependencies) => {
  const cookieNames = authCookieNamesFor(secureCookies)
  const cookieOptions = cookieOptionsFor(secureCookies)
  const routes = new Hono<AppEnvironment>()

  routes.get('/session', (context) => {
    const session = context.get('session')
    const sessionState: SessionState = {
      signInRequired,
      signInAvailable: githubSignIn !== null,
      user: session === null ? null : session.user,
    }
    return context.json(sessionState)
  })

  routes.post('/sign-out', (context) => {
    sessionStore.removeSession(getCookie(context, cookieNames.session))
    deleteCookie(context, cookieNames.session, cookieOptions)
    return context.body(null, 204)
  })

  const completeSignIn = async (signIn: GitHubSignIn, code: string, codeVerifier: string): Promise<SignInFailure | { sessionId: string; lifetimeMilliseconds: number }> => {
    const userToken = await signIn.client.exchangeCode(code, codeVerifier)
    const user = await signIn.client.readUser(userToken.accessToken)
    if (!isAllowedLogin(user.login, signIn.settings.allowedLogins)) return 'not-allowed'
    const { credentials, expiresAt, lifetimeMilliseconds } = credentialsFromUserToken(userToken, now())
    return { sessionId: sessionStore.createSession(user, credentials, expiresAt), lifetimeMilliseconds }
  }

  routes.get('/github/start', (context) => {
    if (githubSignIn === null) return context.json({ error: 'GitHub sign-in is not configured' }, 404)
    const codeVerifier = createRandomToken()
    const state = sessionStore.createPendingSignIn(codeVerifier)
    // Binding the state to this browser is what stops someone from sending you a callback
    // link that signs you in to their account.
    setCookie(context, cookieNames.pendingSignIn, state, { ...cookieOptions, maxAge: pendingSignInSeconds })
    return context.redirect(buildAuthorizeUrl(githubSignIn.settings, state, codeVerifier))
  })

  routes.get('/github/callback', async (context) => {
    if (githubSignIn === null) return context.json({ error: 'GitHub sign-in is not configured' }, 404)
    const state = context.req.query('state')
    const code = context.req.query('code')
    const stateInBrowser = getCookie(context, cookieNames.pendingSignIn)
    deleteCookie(context, cookieNames.pendingSignIn, cookieOptions)
    const pendingSignIn = state !== undefined && state === stateInBrowser ? sessionStore.takePendingSignIn(state) : null
    if (pendingSignIn === null) return context.redirect(signInFailedPath('expired'))
    // GitHub comes back without a code when the person cancels on its consent screen.
    if (code === undefined) return context.redirect(signInFailedPath('failed'))

    const outcome = await completeSignIn(githubSignIn, code, pendingSignIn.codeVerifier).catch((): SignInFailure => 'failed')
    if (typeof outcome === 'string') return context.redirect(signInFailedPath(outcome))
    setCookie(context, cookieNames.session, outcome.sessionId, {
      ...cookieOptions,
      maxAge: Math.floor(outcome.lifetimeMilliseconds / 1000),
    })
    return context.redirect('/')
  })

  return routes
}
