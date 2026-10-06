import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import type { Board, CreatedIssue, NetlifyStatus } from '@dashi/contracts'
import { createActivityRoutes, createIngestRoutes, ingestApiPaths } from '../activity/activity-routes.ts'
import type { PullRequestFinder } from '../activity/aggregate.ts'
import { authCookieNamesFor, createAuthRoutes, publicApiPaths } from '../auth/auth-routes.ts'
import { fetchPullRequestBodyHtml, fetchRepositoryBoard } from '../github/board.ts'
import { mediaUrlFromBodyHtml } from '../github/media.ts'
import { createIssue } from '../github/issues.ts'
import { closePullRequest, mergePullRequest, setPullRequestDraft } from '../github/pull-request-actions.ts'
import { fetchPullRequestFiles } from '../github/pull-request-files.ts'
import type { PullRequestActionResult } from '../github/types.ts'
import { hasStoredRecording, readStoredMedia, storePreviewFiles } from '../media/media-store.ts'
import { downloadPreviewFiles, fetchPreviewArtifacts, withPreviewMedia } from '../media/preview-artifacts.ts'
import type { PreviewArtifactsBySha } from '../media/types.ts'
import { activeStatusOf, enableNetlifyForRepository, fetchNetlifySites, findSiteForRepository } from '../netlify/sites.ts'
import { findRepository } from '../repos/load-repositories.ts'
import { createChatRelay } from '../session-chat/chat-relay.ts'
import { createRunnerChatRoutes, createSessionChatRoutes } from '../session-chat/session-chat-routes.ts'
import { createMachineRoutes, machineApiPathPrefixes } from '../machines/machine-routes.ts'
import { createPairingRelay } from '../machines/pairing-relay.ts'
import { createAttachmentRelay } from '../session-starts/attachments.ts'
import { createRunnerRoutes, createSessionStartRoutes, runnerApiPathPrefix } from '../session-starts/session-start-routes.ts'
import type { PullRequestDraftMarker } from '../session-starts/types.ts'
import { isAllowedHostHeader, isSameOriginRequest } from '../runtime/settings.ts'
import { createRedactor } from '../secrets/redact.ts'
import type { DashboardSession } from '../auth/types.ts'
import { readJsonBody } from './http.ts'
import type { AppDependencies, AppEnvironment } from './types.ts'

const passphraseBodySchema = z.object({ passphrase: z.string().min(1) })
const secretBodySchema = z.object({ value: z.string().min(1).max(4096) })
const rotateBodySchema = z.object({ nextKey: z.string().min(1) })
const mediaParamsSchema = z.object({ number: z.coerce.number().int().positive(), kind: z.enum(['image', 'video', 'before']) })
const commitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/)
const pullRequestNumberSchema = z.coerce.number().int().positive()
const draftBodySchema = z.object({ draft: z.boolean() })
const mergeBodySchema = z.object({ title: z.string().trim().min(1).max(256), headSha: z.string().regex(/^[0-9a-f]{40}$/) })
const newIssueBodySchema = z.object({ title: z.string().trim().min(1).max(256), body: z.string().max(60000).default('') })

// GitHub answers 403 or 404 when the token may read a repository but not write to it; saying
// which permission is missing saves a trip through the GitHub App settings.
const pullRequestWriteHint = 'The GitHub App or stored token needs write access to pull requests and contents.'
const issueWriteHint = 'The GitHub App or stored token needs write access to issues.'

const actionErrorOf = (
  result: Extract<PullRequestActionResult, { ok: false }>,
  writeAccessHint: string,
): { status: 403 | 409; body: { error: string } } =>
  result.status === 403 || result.status === 404
    ? { status: 403, body: { error: `${result.message}. ${writeAccessHint}` } }
    : { status: 409, body: { error: result.message } }

// GitHub's signed attachment links last about five minutes, so a rendered body is reused for
// less than half of that and every link handed to the browser still has time left to play.
const bodyHtmlCacheMilliseconds = 2 * 60_000

/**
 * Builds the dashboard's HTTP app: security headers, the Host and origin guard, sign-in, and every /api route.
 * @param dependencies The vault, auth, repositories and GitHub access the routes use; injected so tests can swap each one.
 * @returns The Hono app, ready to serve or to call in tests with app.request.
 */
export const createApp = (dependencies: AppDependencies): Hono<AppEnvironment> => {
  const { vault, auth, activity, repositories, secretDefinitions } = dependencies
  const sessionCookieName = authCookieNamesFor(auth.secureCookies).session
  const boardCache = new Map<string, { board: Board; storedAt: number }>()
  const bodyHtmlCache = new Map<string, { bodyHtml: string | null; storedAt: number }>()
  const artifactCache = new Map<string, { artifactsBySha: PreviewArtifactsBySha; storedAt: number }>()
  const app = new Hono<AppEnvironment>()

  // Set here rather than in the reverse proxy, so they hold whichever proxy is in front.
  // Browsers ignore HSTS over plain http, so it is only sent when the dashboard is behind https.
  app.use(
    '*',
    secureHeaders({ xFrameOptions: 'DENY', strictTransportSecurity: auth.secureCookies ? 'max-age=31536000' : false }),
  )

  app.use('/api/*', async (context, next) => {
    const hostHeader = context.req.header('host')
    if (!isAllowedHostHeader(hostHeader, dependencies.allowedHostNames)) return context.json({ error: 'Unknown host' }, 403)
    const isMutation = context.req.method !== 'GET' && context.req.method !== 'HEAD'
    if (isMutation && !isSameOriginRequest(context.req.header('origin'), hostHeader)) {
      return context.json({ error: 'Cross-origin request refused' }, 403)
    }
    if (isMutation && !(context.req.header('content-type') ?? '').startsWith('application/json')) {
      return context.json({ error: 'Send JSON' }, 415)
    }
    return next()
  })

  app.use('/api/*', async (context, next) => {
    const session = auth.sessionStore.readSession(getCookie(context, sessionCookieName))
    context.set('session', session)
    const needsNoSession =
      publicApiPaths.includes(context.req.path) ||
      ingestApiPaths.includes(context.req.path) ||
      context.req.path.startsWith(runnerApiPathPrefix) ||
      machineApiPathPrefixes.some((pathPrefix) => context.req.path.startsWith(pathPrefix))
    if (auth.signInRequired && session === null && !needsNoSession) {
      return context.json({ error: 'Sign in with GitHub first' }, 401)
    }
    return next()
  })

  app.onError((error, context) => {
    const session = context.get('session')
    const redact = createRedactor([...vault.readAllSecretValues(), ...(session ? [session.githubToken] : [])])
    return context.json({ error: redact(error.message) }, 400)
  })

  // Usage is joined to pull requests through boards already fetched for someone, so reading
  // usage never spends a GitHub request of its own.
  const findPullRequest: PullRequestFinder = (repository, branch) =>
    [...boardCache.values()]
      .filter(({ board }) => board.repository.owner === repository.owner && board.repository.name === repository.name)
      .flatMap(({ board }) => board.columns.flatMap((column) => column.cards))
      .find((card) => card.pullRequest?.headRefName === branch)?.pullRequest?.number ?? null

  app.route('/api/auth', createAuthRoutes(auth))
  app.route('/api', createIngestRoutes(activity))
  app.route('/api', createActivityRoutes(activity, findPullRequest))
  const markPullRequestDraft: PullRequestDraftMarker = async (session, repository, pullRequestNumber) => {
    const githubToken = session?.githubToken ?? vault.readSecretValue('github-token')
    if (githubToken === null) return
    const result = await setPullRequestDraft(dependencies.createGraphqlFetcher(githubToken), repository, pullRequestNumber, true)
    if (result.ok) forgetBoardsOf(repository)
  }
  const sessionStartDependencies = {
    ...dependencies.sessionStarts,
    attachmentRelay: createAttachmentRelay(dependencies.now),
    markPullRequestDraft,
    vault,
    repositories,
    now: dependencies.now,
  }
  app.route('/api', createSessionStartRoutes(sessionStartDependencies))
  app.route('/api/runner', createRunnerRoutes(sessionStartDependencies))
  const sessionChatDependencies = {
    chatRelay: createChatRelay(dependencies.now),
    activityStore: activity.activityStore,
    runnerTokens: dependencies.sessionStarts.runnerTokens,
    startStore: dependencies.sessionStarts.startStore,
    vault,
    now: dependencies.now,
  }
  app.route('/api', createSessionChatRoutes(sessionChatDependencies))
  app.route(
    '/api',
    createMachineRoutes({
      pairingRelay: createPairingRelay(dependencies.now),
      ingestTokens: activity.ingestTokens,
      runnerTokens: dependencies.sessionStarts.runnerTokens,
      cliScriptPath: dependencies.cliScriptPath,
    }),
  )
  app.route('/api/runner', createRunnerChatRoutes(sessionChatDependencies))

  app.get('/api/health', (context) => context.json({ ok: true }))

  app.get('/api/vault', (context) => context.json(vault.readState()))

  app.post('/api/vault/setup', async (context) => {
    const { passphrase } = passphraseBodySchema.parse(await readJsonBody(context.req.raw))
    vault.initialise(passphrase)
    return context.json(vault.readState())
  })

  app.post('/api/vault/unlock', async (context) => {
    const { passphrase } = passphraseBodySchema.parse(await readJsonBody(context.req.raw))
    vault.unlock(passphrase)
    return context.json(vault.readState())
  })

  app.post('/api/vault/lock', (context) => {
    vault.lock()
    return context.json(vault.readState())
  })

  app.post('/api/vault/rotate', async (context) => {
    const { nextKey } = rotateBodySchema.parse(await readJsonBody(context.req.raw))
    vault.rotate(nextKey)
    return context.json(vault.readState())
  })

  const findDefinition = (name: string) => secretDefinitions.find((definition) => definition.name === name)

  app.get('/api/secrets', (context) =>
    context.json(vault.listSecrets(secretDefinitions.map(({ name, label, description, tokenPageUrl }) => ({ name, label, description, tokenPageUrl })))),
  )

  app.put('/api/secrets/:name', async (context) => {
    const secretName = context.req.param('name')
    if (findDefinition(secretName) === undefined) return context.json({ error: 'Unknown secret' }, 404)
    const { value } = secretBodySchema.parse(await readJsonBody(context.req.raw))
    vault.saveSecret(secretName, value)
    boardCache.clear()
    return context.body(null, 204)
  })

  app.delete('/api/secrets/:name', (context) => {
    vault.deleteSecret(context.req.param('name'))
    boardCache.clear()
    return context.body(null, 204)
  })

  app.post('/api/secrets/:name/test', async (context) => {
    const definition = findDefinition(context.req.param('name'))
    if (definition === undefined) return context.json({ error: 'Unknown secret' }, 404)
    const secretValue = vault.readSecretValue(definition.name)
    if (secretValue === null) return context.json({ ok: false, status: null, message: 'Not set' })
    return context.json(await dependencies.testSecret(definition, secretValue))
  })

  app.get('/api/repositories', (context) => context.json(repositories))

  // Each signed-in user reads GitHub through their own token, so caches are kept per reader.
  const readerKeyOf = (session: DashboardSession | null): string => session?.user.login ?? '(stored token)'
  const githubTokenOf = (session: DashboardSession | null): string | null => session?.githubToken ?? vault.readSecretValue('github-token')
  const readBodyHtml = async (cacheKey: string, loadBodyHtml: () => Promise<string | null>): Promise<string | null> => {
    const cachedBodyHtml = bodyHtmlCache.get(cacheKey)
    if (cachedBodyHtml && dependencies.now() - cachedBodyHtml.storedAt < bodyHtmlCacheMilliseconds) return cachedBodyHtml.bodyHtml
    const bodyHtml = await loadBodyHtml()
    bodyHtmlCache.set(cacheKey, { bodyHtml, storedAt: dependencies.now() })
    return bodyHtml
  }
  const readPreviewArtifacts = async (
    cacheKey: string,
    loadArtifacts: () => Promise<PreviewArtifactsBySha>,
    wantsFresh: boolean,
  ): Promise<PreviewArtifactsBySha> => {
    const cachedArtifacts = artifactCache.get(cacheKey)
    if (!wantsFresh && cachedArtifacts && dependencies.now() - cachedArtifacts.storedAt < dependencies.boardCacheMilliseconds) {
      return cachedArtifacts.artifactsBySha
    }
    const artifactsBySha = await loadArtifacts()
    artifactCache.set(cacheKey, { artifactsBySha, storedAt: dependencies.now() })
    return artifactsBySha
  }
  const missingTokenError = { error: 'Sign in with GitHub, or save a GitHub token under Credentials' }

  app.get('/api/repositories/:owner/:name/board', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const session = context.get('session')
    const cacheKey = `${readerKeyOf(session)}:${repository.owner}/${repository.name}`
    const cachedBoard = boardCache.get(cacheKey)
    const wantsFresh = context.req.query('refresh') === '1'
    if (cachedBoard && !wantsFresh && dependencies.now() - cachedBoard.storedAt < dependencies.boardCacheMilliseconds) {
      return context.json(cachedBoard.board)
    }
    const githubToken = githubTokenOf(session)
    if (githubToken === null) return context.json(missingTokenError, 412)
    const [boardFromGithub, artifactsBySha] = await Promise.all([
      fetchRepositoryBoard(dependencies.createGraphqlFetcher(githubToken), repository),
      readPreviewArtifacts(cacheKey, () => fetchPreviewArtifacts(dependencies.createGithubRestFetcher(githubToken), repository), true),
    ])
    const board = withPreviewMedia(boardFromGithub, artifactsBySha)
    boardCache.set(cacheKey, { board, storedAt: dependencies.now() })
    return context.json(board)
  })

  const forgetBoardsOf = (repository: { owner: string; name: string }): void =>
    [...boardCache.keys()]
      .filter((cacheKey) => cacheKey.endsWith(`:${repository.owner}/${repository.name}`))
      .forEach((cacheKey) => boardCache.delete(cacheKey))

  const answerPullRequestAction = (
    context: Context<AppEnvironment>,
    repository: { owner: string; name: string },
    result: PullRequestActionResult,
  ): Response => {
    if (!result.ok) {
      const actionError = actionErrorOf(result, pullRequestWriteHint)
      return context.json(actionError.body, actionError.status)
    }
    forgetBoardsOf(repository)
    return context.body(null, 204)
  }

  app.post('/api/repositories/:owner/:name/issues', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const newIssue = newIssueBodySchema.parse(await readJsonBody(context.req.raw))
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await createIssue(dependencies.createGithubRestFetcher(githubToken), repository, newIssue)
    if (!result.ok) {
      const actionError = actionErrorOf(result, issueWriteHint)
      return context.json(actionError.body, actionError.status)
    }
    forgetBoardsOf(repository)
    return context.json<CreatedIssue>(result.issue, 201)
  })

  app.post('/api/repositories/:owner/:name/pulls/:number/merge', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    const parsedNumber = pullRequestNumberSchema.safeParse(context.req.param('number'))
    if (repository === undefined || !parsedNumber.success) return context.json({ error: 'Unknown pull request' }, 404)
    const { title, headSha } = mergeBodySchema.parse(await readJsonBody(context.req.raw))
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await mergePullRequest(dependencies.createGithubRestFetcher(githubToken), repository, {
      number: parsedNumber.data,
      title,
      headSha,
    })
    return answerPullRequestAction(context, repository, result)
  })

  app.post('/api/repositories/:owner/:name/pulls/:number/draft', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    const parsedNumber = pullRequestNumberSchema.safeParse(context.req.param('number'))
    if (repository === undefined || !parsedNumber.success) return context.json({ error: 'Unknown pull request' }, 404)
    const { draft } = draftBodySchema.parse(await readJsonBody(context.req.raw))
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await setPullRequestDraft(dependencies.createGraphqlFetcher(githubToken), repository, parsedNumber.data, draft)
    return answerPullRequestAction(context, repository, result)
  })

  app.post('/api/repositories/:owner/:name/pulls/:number/close', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    const parsedNumber = pullRequestNumberSchema.safeParse(context.req.param('number'))
    if (repository === undefined || !parsedNumber.success) return context.json({ error: 'Unknown pull request' }, 404)
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await closePullRequest(dependencies.createGithubRestFetcher(githubToken), repository, parsedNumber.data)
    return answerPullRequestAction(context, repository, result)
  })

  app.get('/api/repositories/:owner/:name/pulls/:number/files', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    const parsedNumber = pullRequestNumberSchema.safeParse(context.req.param('number'))
    if (repository === undefined || !parsedNumber.success) return context.json({ error: 'Unknown pull request' }, 404)
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await fetchPullRequestFiles(dependencies.createGithubRestFetcher(githubToken), repository, parsedNumber.data)
    if (!result.ok) return context.json({ error: result.message }, 502)
    return context.json(result.pullRequestFiles)
  })

  const netlifyStatusCache = new Map<string, { status: NetlifyStatus; storedAt: number }>()
  const missingNetlifyTokenError = { error: 'Save a Netlify token under Credentials first' }

  app.get('/api/repositories/:owner/:name/netlify', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const netlifyToken = vault.readSecretValue('netlify-token')
    if (netlifyToken === null) return context.json<NetlifyStatus>({ state: 'missing-token' })
    const cacheKey = `${repository.owner}/${repository.name}`
    const cachedStatus = netlifyStatusCache.get(cacheKey)
    if (cachedStatus && dependencies.now() - cachedStatus.storedAt < dependencies.boardCacheMilliseconds) {
      return context.json(cachedStatus.status)
    }
    const site = findSiteForRepository(await fetchNetlifySites(dependencies.createNetlifyFetcher(netlifyToken)), repository)
    const status: NetlifyStatus = site ? activeStatusOf(site) : { state: 'inactive' }
    netlifyStatusCache.set(cacheKey, { status, storedAt: dependencies.now() })
    return context.json(status)
  })

  app.post('/api/repositories/:owner/:name/netlify', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const netlifyToken = vault.readSecretValue('netlify-token')
    if (netlifyToken === null) return context.json(missingNetlifyTokenError, 412)
    const githubToken = githubTokenOf(context.get('session'))
    if (githubToken === null) return context.json(missingTokenError, 412)
    const result = await enableNetlifyForRepository(
      dependencies.createNetlifyFetcher(netlifyToken),
      dependencies.createGithubRestFetcher(githubToken),
      repository,
    )
    if (!result.ok) return context.json({ error: result.message }, result.status === 401 || result.status === 403 ? 403 : 409)
    netlifyStatusCache.set(`${repository.owner}/${repository.name}`, { status: result.status, storedAt: dependencies.now() })
    return context.json(result.status)
  })

  // The pr-preview recording of the pull request's head commit comes first, served from this
  // origin. Without one, the browser is sent on to the first image or video in the body through
  // a link GitHub signed for this reader, which works for private repositories too.
  app.get('/api/repositories/:owner/:name/pulls/:number/media/:kind', async (context) => {
    const repository = findRepository(repositories, context.req.param('owner'), context.req.param('name'))
    const parsedParams = mediaParamsSchema.safeParse(context.req.param())
    if (repository === undefined || !parsedParams.success) return context.json({ error: 'Unknown media' }, 404)
    const { kind, number: pullRequestNumber } = parsedParams.data
    const session = context.get('session')
    const githubToken = githubTokenOf(session)
    if (githubToken === null) return context.json(missingTokenError, 412)
    const repositoryCacheKey = `${readerKeyOf(session)}:${repository.owner}/${repository.name}`

    const parsedSha = commitShaSchema.safeParse(context.req.query('sha'))
    const artifactsBySha = parsedSha.success
      ? await readPreviewArtifacts(
          repositoryCacheKey,
          () => fetchPreviewArtifacts(dependencies.createGithubRestFetcher(githubToken), repository),
          false,
        )
      : new Map<string, number>()
    const artifactId = parsedSha.success ? artifactsBySha.get(parsedSha.data) : undefined
    if (artifactId !== undefined) {
      const storedMedia =
        (await readStoredMedia(dependencies.mediaCacheDirectory, artifactId, kind)) ??
        ((await hasStoredRecording(dependencies.mediaCacheDirectory, artifactId))
          ? null
          : await downloadPreviewFiles(dependencies.createGithubRestFetcher(githubToken), repository, artifactId)
              .then((files) => storePreviewFiles(dependencies.mediaCacheDirectory, artifactId, files))
              .then(() => readStoredMedia(dependencies.mediaCacheDirectory, artifactId, kind)))
      if (storedMedia !== null) {
        return context.body(storedMedia.bytes, 200, {
          'content-type': storedMedia.contentType,
          'cache-control': 'private, max-age=86400, immutable',
          // The bytes come from whoever ran the workflow; a sandbox keeps them from ever acting as a page.
          'content-security-policy': "sandbox; default-src 'none'",
        })
      }
    }

    // A pull request body has no before picture; only the recording does.
    if (kind === 'before') return context.json({ error: 'This pull request has no before screenshot' }, 404)
    const cacheKey = `${repositoryCacheKey}#${pullRequestNumber}`
    const bodyHtml = await readBodyHtml(cacheKey, () =>
      fetchPullRequestBodyHtml(dependencies.createGraphqlFetcher(githubToken), repository, pullRequestNumber),
    )
    const mediaUrl = bodyHtml === null ? null : mediaUrlFromBodyHtml(bodyHtml, kind)
    if (mediaUrl === null) return context.json({ error: `This pull request has no ${kind}` }, 404)
    context.header('cache-control', 'no-store')
    return context.redirect(mediaUrl, 302)
  })

  return app
}
