import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { bearerTokenOf, limitTo, readJsonBody } from '../app/http.ts'
import type { AppEnvironment } from '../app/types.ts'
import { buildSessionsOverview, buildUsageReport, type PullRequestFinder } from './aggregate.ts'
import { cloudSessionIdOf } from '../session-chat/cloud-conversations.ts'
import { agentEventFrom, hookChatMessageOf, tokenUsagePointsFrom } from './ingest.ts'
import { agentStatusSchema } from '../session-starts/schema.ts'
import { hookPayloadSchema, otlpMetricsSchema } from './schema.ts'
import type { ActivityDependencies, AgentStatusRecorder, CloudHookRecorder, UsageStart } from './types.ts'

// Reached by Claude Code and Codex rather than a browser, so they carry an ingest token
// instead of a sign-in; the session guard lets exactly these through.
export const ingestApiPaths = ['/api/events', '/api/telemetry/v1/metrics']
// An agent saying what state it is in; it can only write that one field of its own start.
export const agentStatusApiPathPattern = /^\/api\/session-starts\/[^/]+\/status$/

const hourMilliseconds = 60 * 60_000
const createTokenBodySchema = z.object({ label: z.string().trim().min(1).max(80) })

const clampedNumber = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback
}

/**
 * Builds the routes Claude Code and Codex report to: hook events, OTLP token metrics and an agent's own status, each behind an ingest token.
 * @param dependencies The activity store, the ingest tokens and the clock.
 * @param recordCloudHook Takes a cloud session's hooks, which make up its chat.
 * @param recordAgentStatus Keeps the state an agent reports for its own start.
 * @returns The routes, mounted under /api.
 */
export const createIngestRoutes = ({ activityStore, ingestTokens, now }: ActivityDependencies, recordCloudHook: CloudHookRecorder, recordAgentStatus: AgentStatusRecorder) => {
  const routes = new Hono<AppEnvironment & { Variables: { ingestTokenId: string } }>()
  // The token's id is kept so usage can be told apart by the machine that reported it.
  const requireIngestToken = createMiddleware<{ Variables: { ingestTokenId: string } }>(async (context, next) => {
    const ingestToken = ingestTokens.verifyToken(bearerTokenOf(context.req.header('authorization')))
    if (ingestToken === null) return context.json({ error: 'Send a valid ingest token' }, 401)
    context.set('ingestTokenId', ingestToken.tokenId)
    return next()
  })

  // Room for a long final reply, which a cloud session's Stop hook carries whole.
  routes.post('/events', requireIngestToken, limitTo(512 * 1024), async (context) => {
    const parsedPayload = hookPayloadSchema.safeParse(await readJsonBody(context.req.raw))
    if (!parsedPayload.success) return context.json({ error: 'Unrecognised event' }, 400)
    const event = agentEventFrom(
      parsedPayload.data,
      {
        provider: context.req.header('x-agent-provider'),
        branch: context.req.header('x-agent-branch'),
        remote: context.req.header('x-agent-remote'),
        cwd: context.req.header('x-agent-cwd'),
        launcher: context.req.header('x-agent-launcher'),
        terminal: context.req.header('x-agent-terminal'),
        app: context.req.header('x-agent-app'),
        billing: context.req.header('x-agent-billing'),
        apiHost: context.req.header('x-agent-api-host'),
        startId: context.req.header('x-dashi-start-id'),
      },
      new Date(now()).toISOString(),
    )
    if (event !== null) activityStore.recordEvent(event)
    const cloudSessionId = cloudSessionIdOf(context.req.header('x-agent-cloud-session'))
    const hookSessionId = parsedPayload.data.session_id
    if (cloudSessionId !== null && hookSessionId !== undefined) {
      recordCloudHook(hookSessionId, cloudSessionId, hookChatMessageOf(parsedPayload.data))
    }
    return context.body(null, 204)
  })

  routes.post('/session-starts/:startId/status', requireIngestToken, limitTo(8 * 1024), async (context) => {
    const parsedReport = agentStatusSchema.safeParse(await readJsonBody(context.req.raw))
    if (!parsedReport.success) return context.json({ error: 'Send {"status": "working" | "waiting" | "blocked" | "done", "note": "..."}' }, 400)
    return recordAgentStatus(context.req.param('startId'), parsedReport.data)
      ? context.body(null, 204)
      : context.json({ error: 'Unknown start' }, 404)
  })

  routes.post('/telemetry/v1/metrics', requireIngestToken, limitTo(1024 * 1024), async (context) => {
    const parsedRequest = otlpMetricsSchema.safeParse(await readJsonBody(context.req.raw))
    if (!parsedRequest.success) return context.json({ error: 'Not an OTLP metrics request' }, 400)
    activityStore.recordTokenUsage(tokenUsagePointsFrom(parsedRequest.data, new Date(now()).toISOString()), context.get('ingestTokenId'))
    // An empty ExportMetricsServiceResponse: everything was accepted.
    return context.json({})
  })

  return routes
}

/**
 * Builds the routes the dashboard reads sessions and usage from, and manages ingest tokens with.
 * @param dependencies The activity store, the ingest tokens and the clock.
 * @param findPullRequest Finds the open pull request of a branch, so usage can be shown per pull request.
 * @param listStartsSince Lists the board's starts since a time, so usage can tell sessions it started.
 * @returns The routes, mounted under /api.
 */
export const createActivityRoutes = (
  { activityStore, ingestTokens, now }: ActivityDependencies,
  findPullRequest: PullRequestFinder,
  listStartsSince: (since: string) => UsageStart[],
) => {
  const routes = new Hono<AppEnvironment>()
  const isoHoursAgo = (hours: number): string => new Date(now() - hours * hourMilliseconds).toISOString()

  routes.get('/sessions', (context) => {
    const windowStartedAt = isoHoursAgo(clampedNumber(context.req.query('hours'), 24, 1, 24 * 7))
    return context.json(
      buildSessionsOverview(
        activityStore.readSessions(),
        activityStore.readEventsSince(windowStartedAt),
        activityStore.readTokenSamplesSince(windowStartedAt),
        windowStartedAt,
        now(),
        { starts: listStartsSince(windowStartedAt) },
      ),
    )
  })

  routes.get('/usage', (context) => {
    const windowStartedAt = isoHoursAgo(clampedNumber(context.req.query('days'), 30, 1, 90) * 24)
    return context.json(
      buildUsageReport(
        activityStore.readSessions(),
        activityStore.readTokenSamplesSince(windowStartedAt),
        findPullRequest,
        windowStartedAt,
        now(),
        {
          machineLabelOf: (tokenId) => ingestTokens.listTokens().find((ingestToken) => ingestToken.tokenId === tokenId)?.label ?? null,
          starts: listStartsSince(windowStartedAt),
        },
      ),
    )
  })

  routes.get('/ingest-tokens', (context) => context.json(ingestTokens.listTokens()))

  routes.post('/ingest-tokens', async (context) => {
    const { label } = createTokenBodySchema.parse(await readJsonBody(context.req.raw))
    return context.json(ingestTokens.createToken(label), 201)
  })

  routes.delete('/ingest-tokens/:tokenId', (context) => {
    ingestTokens.revokeToken(context.req.param('tokenId'))
    return context.body(null, 204)
  })

  return routes
}
