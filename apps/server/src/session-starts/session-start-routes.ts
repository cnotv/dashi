import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import type {
  RepositoryReference,
  RoutineSettings,
  RoutineTestResult,
  RunnerPresence,
  ServedScriptInfo,
  SessionStart,
  SessionStartDetails,
  SessionStartRequest,
  StartAttachment,
  StartOptions,
} from '@dashi/contracts'
import { bearerTokenOf, limitTo, readJsonBody } from '../app/http.ts'
import type { AppEnvironment } from '../app/types.ts'
import type { DashboardSession } from '../auth/types.ts'
import { findRepository } from '../repos/load-repositories.ts'
import { sessionNameFor, sessionPromptFor } from './prompt.ts'
import { attachmentDeliveryFor, attachmentLimitProblem, attachmentLimits } from './attachments.ts'
import { routineSettingsBodySchema, runnerReportSchema, sessionStartSubmissionSchema } from './schema.ts'
import type { MachineTokenStore } from '../machine-tokens/types.ts'
import type { SessionStartDependencies } from './types.ts'

// A runner asks every few seconds, so one silent for this long is taken to be off.
const runnerOnlineMilliseconds = 30_000
const createTokenBodySchema = z.object({ label: z.string().trim().min(1).max(80) })
// Room for the largest attachments a laptop session takes, once base64 and JSON have grown them.
const sessionStartBodyBytes = 12 * 1024 * 1024
// The routines API refuses a longer text with a bare 400.
const routineTextCharacters = 65_536
const runnerSourcePath = 'apps/runner/src/runner.ts'
const routineTestText =
  "Dashi test run: reply 'Dashi can start this routine' and end the session. Do not change any file, branch, issue or pull request."

type LaunchResult = { ok: true; start: SessionStart } | { ok: false; status: 404 | 412 | 413; error: string }

// Reached by the laptop runner rather than a browser, so it carries a runner token instead of a
// sign-in; the session guard lets this prefix through, and the script itself holds no secret.
export const runnerApiPathPrefix = '/api/runner/'

const routineTokenSecretName = (repository: RepositoryReference): string =>
  `routine-token:${repository.owner}/${repository.name}`.toLowerCase()

const presenceOf = (lastUsedAt: string | null, label: string, now: number): RunnerPresence[] =>
  lastUsedAt === null ? [] : [{ label, lastSeenAt: lastUsedAt, isOnline: now - Date.parse(lastUsedAt) < runnerOnlineMilliseconds }]

/**
 * Tells whether any laptop runner has asked for work recently.
 * @param runnerTokens The runner tokens, which record when each was last used.
 * @param now The current time in milliseconds.
 * @returns True when at least one runner is online.
 */
export const isAnyRunnerOnline = (runnerTokens: MachineTokenStore, now: number): boolean =>
  runnerTokens.listTokens().some((runnerToken) => presenceOf(runnerToken.lastUsedAt, runnerToken.label, now).some((presence) => presence.isOnline))

/**
 * Builds the guard on every route the runner calls: a valid runner token, whose label is kept for the handler.
 * @param runnerTokens The runner tokens.
 * @returns The middleware.
 */
export const createRunnerTokenGuard = (runnerTokens: MachineTokenStore) =>
  createMiddleware<{ Variables: { runnerLabel: string } }>(async (context, next) => {
    const runnerToken = runnerTokens.verifyToken(bearerTokenOf(context.req.header('authorization')))
    if (runnerToken === null) return context.json({ error: 'Send a valid runner token' }, 401)
    context.set('runnerLabel', runnerToken.label)
    return next()
  })

/**
 * Builds the routes that start sessions from the board: the Start dialog's options, the list
 * of starts, each repository's routine, and the runner tokens a laptop uses.
 * @param dependencies The stores, the vault and the routine caller.
 * @returns The routes, mounted under /api.
 */
export const createSessionStartRoutes = (dependencies: SessionStartDependencies) => {
  const { startStore, routineStore, runnerTokens, vault, repositories, fireRoutine, attachmentRelay, markPullRequestDraft, now } = dependencies
  const routes = new Hono<AppEnvironment>()

  const repositoryOf = (owner: string, name: string): RepositoryReference | undefined => findRepository(repositories, owner, name)
  const routineOf = (repository: RepositoryReference): { routineId: string; routineToken: string } | null => {
    const routineId = routineStore.readRoutineId(repository)
    const routineToken = vault.readSecretValue(routineTokenSecretName(repository))
    return routineId === null || routineToken === null ? null : { routineId, routineToken }
  }

  routes.get('/start-options', (context) => {
    const repository = repositoryOf(context.req.query('owner') ?? '', context.req.query('name') ?? '')
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const options: StartOptions = {
      runners: runnerTokens.listTokens().flatMap((runnerToken) => presenceOf(runnerToken.lastUsedAt, runnerToken.label, now())),
      routineConfigured: routineStore.readRoutineId(repository) !== null && vault.readSecretValue(routineTokenSecretName(repository)) !== null,
      attachmentLimits,
    }
    return context.json(options)
  })

  // The attachments are never stored: a laptop start's wait in memory for its runner, and a
  // routine's go out with the prompt. A start on a pull request turns it back into a draft first,
  // so the board shows it as being changed until the session marks it ready again.
  const launchStart = async (
    request: SessionStartRequest,
    attachments: StartAttachment[],
    session: DashboardSession | null,
  ): Promise<LaunchResult> => {
    const repository = repositoryOf(request.repository.owner, request.repository.name)
    if (repository === undefined) return { ok: false, status: 404, error: 'Unknown repository' }
    const limitProblem = attachmentLimitProblem(attachments, request.target)
    if (limitProblem !== null) return { ok: false, status: 413, error: limitProblem }
    const routine = request.target === 'cloud-routine' ? routineOf(repository) : null
    if (request.target === 'cloud-routine' && routine === null) {
      return { ok: false, status: 412, error: 'Set up a Claude Code routine for this repository first' }
    }
    const routineText = sessionPromptFor({ ...request, repository }, attachments)
    if (routine !== null && routineText.length > routineTextCharacters) {
      return { ok: false, status: 413, error: `The first message comes to ${routineText.length} characters; a routine takes at most ${routineTextCharacters}` }
    }
    if (request.pullRequestNumber !== null) await markPullRequestDraft(session, repository, request.pullRequestNumber)
    if (routine === null) {
      const queuedStart = startStore.createStart({ ...request, repository })
      attachmentRelay.hold(queuedStart.startId, attachments)
      return { ok: true, start: queuedStart }
    }
    const start = startStore.createStart({ ...request, repository })
    const fireResult = await fireRoutine(routine.routineId, routine.routineToken, routineText)
    const outcome = fireResult.ok
      ? { state: 'started' as const, sessionUrl: fireResult.sessionUrl, message: null }
      : { state: 'failed' as const, sessionUrl: null, message: fireResult.message }
    return { ok: true, start: startStore.recordOutcome(start.startId, outcome) }
  }

  const answerLaunch = (context: Context<AppEnvironment>, launchResult: LaunchResult): Response =>
    launchResult.ok ? context.json<SessionStart>(launchResult.start, 201) : context.json({ error: launchResult.error }, launchResult.status)

  routes.get('/session-starts', (context) => context.json(startStore.listRecentStarts()))

  routes.post('/session-starts', limitTo(sessionStartBodyBytes), async (context) => {
    const { attachments, ...request } = sessionStartSubmissionSchema.parse(await readJsonBody(context.req.raw))
    return answerLaunch(context, await launchStart(request, attachments, context.get('session')))
  })

  // What the session was told, so a start that went wrong can be read in full from the dashboard.
  routes.get('/session-starts/:startId', (context) => {
    const start = startStore.readStart(context.req.param('startId'))
    if (start === null) return context.json({ error: 'Unknown start' }, 404)
    return context.json<SessionStartDetails>({ start, firstMessage: sessionPromptFor(start, []) })
  })

  // A retry is a new start from the same request, so the failed one stays as the record of what
  // happened; its attachments were never kept, so it goes without them.
  routes.post('/session-starts/:startId/retry', async (context) => {
    const failedStart = startStore.readStart(context.req.param('startId'))
    if (failedStart === null) return context.json({ error: 'Unknown start' }, 404)
    if (failedStart.state !== 'failed') return context.json({ error: 'Only a failed start can be retried' }, 409)
    const { repository, issueNumber, pullRequestNumber, workflow, target, permissionMode, note } = failedStart
    return answerLaunch(
      context,
      await launchStart({ repository, issueNumber, pullRequestNumber, workflow, target, permissionMode, note }, [], context.get('session')),
    )
  })

  // Anthropic offers no way to check a routine's token short of running it, so the test is a
  // real, tiny run told to change nothing.
  routes.post('/repositories/:owner/:name/routine/test', async (context) => {
    const repository = repositoryOf(context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const routine = routineOf(repository)
    if (routine === null) return context.json({ error: 'Save a routine id and token first' }, 412)
    const fireResult = await fireRoutine(routine.routineId, routine.routineToken, routineTestText)
    return context.json<RoutineTestResult>(fireResult.ok ? { ok: true, sessionUrl: fireResult.sessionUrl } : { ok: false, message: fireResult.message })
  })

  routes.get('/repositories/:owner/:name/routine', (context) => {
    const repository = repositoryOf(context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const routineId = routineStore.readRoutineId(repository)
    return context.json<RoutineSettings>({
      configured: routineId !== null && vault.readSecretValue(routineTokenSecretName(repository)) !== null,
      routineId,
    })
  })

  routes.put('/repositories/:owner/:name/routine', async (context) => {
    const repository = repositoryOf(context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    const { routineId, token } = routineSettingsBodySchema.parse(await readJsonBody(context.req.raw))
    vault.saveSecret(routineTokenSecretName(repository), token)
    routineStore.saveRoutineId(repository, routineId)
    return context.body(null, 204)
  })

  routes.delete('/repositories/:owner/:name/routine', (context) => {
    const repository = repositoryOf(context.req.param('owner'), context.req.param('name'))
    if (repository === undefined) return context.json({ error: 'Unknown repository' }, 404)
    vault.deleteSecret(routineTokenSecretName(repository))
    routineStore.deleteRoutineId(repository)
    return context.body(null, 204)
  })

  routes.get('/runner-tokens', (context) => context.json(runnerTokens.listTokens()))

  routes.post('/runner-tokens', async (context) => {
    const { label } = createTokenBodySchema.parse(await readJsonBody(context.req.raw))
    return context.json(runnerTokens.createToken(label), 201)
  })

  routes.delete('/runner-tokens/:tokenId', (context) => {
    runnerTokens.revokeToken(context.req.param('tokenId'))
    return context.body(null, 204)
  })

  return routes
}

/**
 * Builds the routes the laptop runner calls: its script, claiming the next start, and reporting on it.
 * Claiming and reporting need a runner token; a runner can only report on starts it claimed.
 * @param dependencies The start store, the runner tokens and where the script is.
 * @returns The routes, mounted under /api/runner.
 */
export const createRunnerRoutes = ({ startStore, runnerTokens, runnerScriptPath, attachmentRelay }: SessionStartDependencies) => {
  const routes = new Hono<AppEnvironment & { Variables: { runnerLabel: string } }>()

  const requireRunnerToken = createRunnerTokenGuard(runnerTokens)

  routes.get('/script', async (context) => {
    context.header('content-type', 'text/plain; charset=utf-8')
    context.header('content-disposition', 'attachment; filename="runner.ts"')
    return context.body(await readFile(runnerScriptPath, 'utf8'))
  })

  routes.get('/script-info', async (context) => {
    const script = await readFile(runnerScriptPath)
    return context.json<ServedScriptInfo>({
      sha256: createHash('sha256').update(script).digest('hex'),
      byteLength: script.byteLength,
      sourcePath: runnerSourcePath,
    })
  })

  routes.post('/claim', requireRunnerToken, (context) => {
    const start = startStore.claimNextLaptopStart(context.get('runnerLabel'))
    if (start === null) return context.body(null, 204)
    const attachments = attachmentRelay.take(start.startId)
    const isFileDelivery = attachmentDeliveryFor(start.target) === 'files'
    return context.json({
      start,
      prompt: sessionPromptFor(start, isFileDelivery ? [] : attachments),
      sessionName: sessionNameFor(start),
      attachments: isFileDelivery ? attachments : [],
    })
  })

  routes.post('/starts/:startId', requireRunnerToken, limitTo(16 * 1024), async (context) => {
    const report = runnerReportSchema.parse(await readJsonBody(context.req.raw))
    const start = startStore.recordRunnerReport(context.req.param('startId'), context.get('runnerLabel'), report)
    return start === null ? context.json({ error: 'No start of this runner is waiting for that report' }, 404) : context.json(start)
  })

  return routes
}
