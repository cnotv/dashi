import type { AgentProvider, AgentSessionState, RepositoryReference } from '@dashi/contracts'
import type {
  AgentEvent,
  HookHeaders,
  HookPayload,
  OtlpKeyValue,
  OtlpMetricsRequest,
  SessionOrigin,
  TokenType,
  TokenUsagePoint,
} from './types.ts'
import { sessionBillingOf } from './origin.ts'

const tokenUsageMetricName = 'claude_code.token.usage'
const tokenTypes: TokenType[] = ['input', 'output', 'cacheRead', 'cacheCreation']
const cumulativeTemporalities = [2, 'AGGREGATION_TEMPORALITY_CUMULATIVE']

const stateByClaudeHookEvent: Record<string, AgentSessionState> = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  Notification: 'waiting',
  Stop: 'idle',
  SessionEnd: 'ended',
}

// Covers https, ssh and scp-style remotes, and proxy remotes such as
// http://proxy@127.0.0.1:port/git/<owner>/<name>: the last two path segments are the repository.
const remoteRepositoryPattern = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/

/**
 * Reads the owner and name from a git remote, whether https, ssh or a proxy address.
 * @param remote The remote URL the hook sent.
 * @returns The repository, or null when the remote is missing or unreadable.
 */
export const repositoryFromRemote = (remote: string | undefined): RepositoryReference | null => {
  const remoteMatch = remote === undefined ? null : remoteRepositoryPattern.exec(remote.trim())
  return remoteMatch?.[1] && remoteMatch[2] ? { owner: remoteMatch[1], name: remoteMatch[2] } : null
}

const providerFrom = (value: string | undefined): AgentProvider => (value === 'codex' ? 'codex' : 'claude')

const stateFor = (provider: AgentProvider, payload: HookPayload): AgentSessionState | null => {
  if (provider === 'codex') return payload.type === 'agent-turn-complete' ? 'idle' : null
  return payload.hook_event_name === undefined ? null : (stateByClaudeHookEvent[payload.hook_event_name] ?? null)
}

// A title is a glance at what the session was asked, so only the first line of the first prompt
// is kept, never the rest of it.
const titleCharacters = 80

const titleFrom = (provider: AgentProvider, payload: HookPayload): string | null => {
  const prompt = provider === 'codex' ? payload['input-messages']?.[0] : payload.prompt
  const firstLine = prompt
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  if (firstLine === undefined) return null
  return firstLine.length <= titleCharacters ? firstLine : `${firstLine.slice(0, titleCharacters - 1).trimEnd()}…`
}

const folderFrom = (cwd: string | undefined): string | null => {
  const folder = cwd?.trim().replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? ''
  return folder === '' ? null : folder
}

const emptyToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' || trimmed === 'HEAD' ? null : trimmed
}

const startIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const originValueCharacters = 120

// A header from the hook is shown on the page, so only one short printable line is kept.
const originValueOf = (value: string | undefined): string | null => {
  const trimmedValue = value?.trim() ?? ''
  return trimmedValue === '' || trimmedValue.length > originValueCharacters || /[^\x20-\x7e]/.test(trimmedValue) ? null : trimmedValue
}

const originFrom = (headers: HookHeaders): SessionOrigin => {
  const startId = originValueOf(headers.startId)
  return {
    launcher: originValueOf(headers.launcher),
    terminal: originValueOf(headers.terminal),
    launchingApp: originValueOf(headers.app),
    billing: sessionBillingOf(headers.billing),
    apiHost: originValueOf(headers.apiHost),
    startId: startId !== null && startIdPattern.test(startId) ? startId : null,
  }
}

/**
 * Turns a Claude Code hook or Codex notification into a session event.
 * @param payload The hook's JSON body.
 * @param headers The provider, branch and remote the hook sent alongside it.
 * @param occurredAt When the event arrived.
 * @returns The event, or null for a hook that says nothing about the session's state.
 */
export const agentEventFrom = (payload: HookPayload, headers: HookHeaders, occurredAt: string): AgentEvent | null => {
  const provider = providerFrom(headers.provider)
  const sessionId = provider === 'codex' ? payload['thread-id'] : payload.session_id
  const state = stateFor(provider, payload)
  if (sessionId === undefined || state === null) return null
  return {
    sessionId,
    provider,
    state,
    repository: repositoryFromRemote(headers.remote),
    branch: emptyToNull(headers.branch),
    title: titleFrom(provider, payload),
    folder: folderFrom(payload.cwd ?? headers.cwd),
    origin: originFrom(headers),
    occurredAt,
  }
}

const attributeValue = (attributes: OtlpKeyValue[], key: string): string | null => {
  const found = attributes.find((attribute) => attribute.key === key)?.value
  if (found === undefined) return null
  if (found.stringValue !== undefined) return found.stringValue
  if (found.intValue !== undefined) return String(found.intValue)
  return null
}

const accountFrom = (attributes: OtlpKeyValue[]): string | null => {
  const organizationId = attributeValue(attributes, 'organization.id')
  return attributeValue(attributes, 'user.email') ?? (organizationId === null ? null : `org:${organizationId}`)
}

// A cloud session is told apart first: it runs in Claude's cloud whatever entrypoint started it.
const launchHintFrom = (attributes: OtlpKeyValue[]): string | null => {
  const cloudSessionId = attributeValue(attributes, 'ccr.session.id')
  return cloudSessionId === null ? attributeValue(attributes, 'app.entrypoint') : `cloud:${cloudSessionId}`
}

const isTokenType = (value: string | null): value is TokenType => tokenTypes.some((tokenType) => tokenType === value)

const nanosecondsToIso = (value: string | number | undefined, fallback: string): string => {
  const milliseconds = Math.floor(Number(value ?? 0) / 1_000_000)
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : fallback
}

/**
 * Picks Claude Code's token counts out of an OTLP metrics export.
 * @param request The parsed OTLP request.
 * @param receivedAt When it arrived, used when a data point carries no time.
 * @returns One point per session, model and token type.
 */
export const tokenUsagePointsFrom = (request: OtlpMetricsRequest, receivedAt: string): TokenUsagePoint[] =>
  request.resourceMetrics.flatMap((resourceMetric) =>
    resourceMetric.scopeMetrics.flatMap((scopeMetric) =>
      scopeMetric.metrics
        .filter((metric) => metric.name === tokenUsageMetricName && metric.sum !== undefined)
        .flatMap((metric) => {
          const isCumulative = cumulativeTemporalities.includes(metric.sum?.aggregationTemporality ?? 0)
          return (metric.sum?.dataPoints ?? []).flatMap((dataPoint): TokenUsagePoint[] => {
            const attributes = [...(resourceMetric.resource?.attributes ?? []), ...dataPoint.attributes]
            const sessionId = attributeValue(attributes, 'session.id')
            const tokenType = attributeValue(attributes, 'type')
            const value = Number(dataPoint.asInt ?? dataPoint.asDouble ?? 0)
            if (sessionId === null || !isTokenType(tokenType) || !Number.isFinite(value) || value < 0) return []
            return [
              {
                sessionId,
                model: attributeValue(attributes, 'model') ?? 'unknown',
                tokenType,
                value: Math.round(value),
                isCumulative,
                seriesStart: nanosecondsToIso(dataPoint.startTimeUnixNano, receivedAt),
                observedAt: nanosecondsToIso(dataPoint.timeUnixNano, receivedAt),
                account: accountFrom(attributes),
                launchHint: launchHintFrom(attributes),
              },
            ]
          })
        }),
    ),
  )
