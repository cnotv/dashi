// Dashi's OpenCode reporter. `dashi connect` saves it as ~/dashi/opencode-reporter.ts, and puts a
// one-line plugin in OpenCode's global plugin folder, ~/.config/opencode/plugins/dashi.ts, that
// re-exports DashiReporter from here; OpenCode can load every export of a plugin file as a plugin,
// so the helpers below stay out of that file. Beside it is ~/dashi/opencode.json, the dashboard's
// address and this machine's ingest token. It reports each session's state and its first prompt's
// first line to /api/events, and each finished answer's token counts to /api/telemetry/v1/metrics,
// the routes Claude Code reports to. It never sends the conversation, and a report that fails is
// dropped so OpenCode is never held up. It imports only Node's standard library, which Bun provides.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ReporterSettings {
  dashboardUrl: string
  ingestToken: string
}

// What /api/events reads from OpenCode: the event, the root session it belongs to, and for the
// first prompt of a session its first line.
export interface SessionReport {
  type: SessionReportType
  session_id: string
  status?: string
  prompt?: string
  cwd?: string
}

export type SessionReportType =
  | 'session.created'
  | 'chat.message'
  | 'session.status'
  | 'session.idle'
  | 'permission.asked'
  | 'permission.replied'
  | 'session.deleted'

interface OtlpAttribute {
  key: string
  value: { stringValue: string }
}

export interface TokenMetricsRequest {
  resourceMetrics: Array<{
    resource: { attributes: OtlpAttribute[] }
    scopeMetrics: Array<{
      metrics: Array<{
        name: string
        sum: {
          aggregationTemporality: number
          dataPoints: Array<{ attributes: OtlpAttribute[]; timeUnixNano: string; asInt: string }>
        }
      }>
    }>
  }>
}

// Which sessions are a subagent's, so their events count toward the session that started them;
// which sessions already sent their first prompt; and which answers already sent their tokens.
export interface ReportTracker {
  parentBySession: ReadonlyMap<string, string>
  promptedSessions: ReadonlySet<string>
  reportedMessages: ReadonlySet<string>
}

export interface EventOutcome {
  tracker: ReportTracker
  sessionReport: SessionReport | null
  tokenReport: TokenMetricsRequest | null
}

interface FinishedAnswer {
  messageId: string
  sessionId: string
  model: string
  completedAt: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
}

// Matched by the server, which counts these beside Claude Code's claude_code.token.usage.
export const tokenMetricName = 'dashi.token.usage'
const deltaTemporality = 1
const promptCharacters = 200
const reportTimeoutMilliseconds = 5000

/**
 * The tracker a plugin starts with: no subagents, prompts or answers seen yet.
 * @returns The empty tracker.
 */
export const emptyTracker = (): ReportTracker => ({ parentBySession: new Map(), promptedSessions: new Set(), reportedMessages: new Set() })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const numberOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

const rootOf = (tracker: ReportTracker, sessionId: string): string => tracker.parentBySession.get(sessionId) ?? sessionId

const isSubagent = (tracker: ReportTracker, sessionId: string): boolean => tracker.parentBySession.has(sessionId)

const withAdded = <Item>(items: ReadonlySet<Item>, item: Item): ReadonlySet<Item> => new Set([...items, item])

const nothingFor = (tracker: ReportTracker): EventOutcome => ({ tracker, sessionReport: null, tokenReport: null })

const reportFor = (tracker: ReportTracker, sessionId: string | null, report: Omit<SessionReport, 'session_id'>): EventOutcome =>
  sessionId === null || isSubagent(tracker, sessionId) ? nothingFor(tracker) : { tracker, sessionReport: { ...report, session_id: sessionId }, tokenReport: null }

const sessionInfoOf = (properties: Record<string, unknown>): { id: string; directory: string | null; parentId: string | null } | null => {
  const info = properties.info
  if (!isRecord(info)) return null
  const id = textOf(info.id)
  return id === null ? null : { id, directory: textOf(info.directory), parentId: textOf(info.parentID) }
}

const finishedAnswerOf = (properties: Record<string, unknown>): FinishedAnswer | null => {
  const info = properties.info
  if (!isRecord(info) || info.role !== 'assistant' || !isRecord(info.time) || !isRecord(info.tokens)) return null
  const messageId = textOf(info.id)
  const sessionId = textOf(info.sessionID)
  const completedAt = numberOf(info.time.completed)
  if (messageId === null || sessionId === null || completedAt === 0) return null
  const cache = isRecord(info.tokens.cache) ? info.tokens.cache : {}
  const providerId = textOf(info.providerID)
  const modelId = textOf(info.modelID) ?? 'unknown'
  return {
    messageId,
    sessionId,
    model: providerId === null ? modelId : `${providerId}/${modelId}`,
    completedAt,
    tokens: {
      input: numberOf(info.tokens.input),
      output: numberOf(info.tokens.output),
      reasoning: numberOf(info.tokens.reasoning),
      cacheRead: numberOf(cache.read),
      cacheWrite: numberOf(cache.write),
    },
  }
}

const attributeOf = (key: string, stringValue: string): OtlpAttribute => ({ key, value: { stringValue } })

/**
 * Turns one finished answer's token counts into an OTLP metrics request, as deltas, since each
 * answer is reported once. Reasoning tokens are billed as output, so they count as output.
 * @param answer The finished answer.
 * @param sessionId The root session the answer belongs to.
 * @returns The request, or null when the answer used no tokens.
 */
const tokenMetricsFor = (answer: FinishedAnswer, sessionId: string): TokenMetricsRequest | null => {
  const counts: Array<[string, number]> = [
    ['input', answer.tokens.input],
    ['output', answer.tokens.output + answer.tokens.reasoning],
    ['cacheRead', answer.tokens.cacheRead],
    ['cacheCreation', answer.tokens.cacheWrite],
  ]
  const dataPoints = counts
    .filter(([, value]) => value > 0)
    .map(([type, value]) => ({
      attributes: [attributeOf('session.id', sessionId), attributeOf('model', answer.model), attributeOf('type', type)],
      timeUnixNano: String(BigInt(answer.completedAt) * 1_000_000n),
      asInt: String(value),
    }))
  if (dataPoints.length === 0) return null
  return {
    resourceMetrics: [
      {
        resource: { attributes: [attributeOf('service.name', 'opencode')] },
        scopeMetrics: [{ metrics: [{ name: tokenMetricName, sum: { aggregationTemporality: deltaTemporality, dataPoints } }] }],
      },
    ],
  }
}

/**
 * Reads one OpenCode event: what to report about the session, what tokens to report, and what to
 * remember for later events. A subagent's session is never reported as a session of its own; its
 * tokens count toward the session that started it.
 * @param tracker What earlier events left.
 * @param event The event as OpenCode's plugin hook passes it.
 * @returns The new tracker and the reports to send, if any.
 */
export const outcomeOfEvent = (tracker: ReportTracker, event: unknown): EventOutcome => {
  if (!isRecord(event) || !isRecord(event.properties)) return nothingFor(tracker)
  const { properties } = event
  const sessionIdOf = (): string | null => textOf(properties.sessionID)
  switch (event.type) {
    case 'session.created': {
      const info = sessionInfoOf(properties)
      if (info === null) return nothingFor(tracker)
      if (info.parentId !== null) {
        return nothingFor({ ...tracker, parentBySession: new Map([...tracker.parentBySession, [info.id, rootOf(tracker, info.parentId)]]) })
      }
      return reportFor(tracker, info.id, { type: 'session.created', ...(info.directory === null ? {} : { cwd: info.directory }) })
    }
    case 'session.status': {
      const status = isRecord(properties.status) ? textOf(properties.status.type) : null
      return status === null ? nothingFor(tracker) : reportFor(tracker, sessionIdOf(), { type: 'session.status', status })
    }
    case 'session.idle':
      return reportFor(tracker, sessionIdOf(), { type: 'session.idle' })
    // Renamed from permission.updated to permission.asked in later OpenCode versions.
    case 'permission.updated':
    case 'permission.asked':
      return reportFor(tracker, sessionIdOf(), { type: 'permission.asked' })
    case 'permission.replied':
      return reportFor(tracker, sessionIdOf(), { type: 'permission.replied' })
    case 'session.deleted':
      return reportFor(tracker, sessionInfoOf(properties)?.id ?? null, { type: 'session.deleted' })
    case 'message.updated': {
      const answer = finishedAnswerOf(properties)
      if (answer === null || tracker.reportedMessages.has(answer.messageId)) return nothingFor(tracker)
      return {
        tracker: { ...tracker, reportedMessages: withAdded(tracker.reportedMessages, answer.messageId) },
        sessionReport: null,
        tokenReport: tokenMetricsFor(answer, rootOf(tracker, answer.sessionId)),
      }
    }
    default:
      return nothingFor(tracker)
  }
}

const firstLineOf = (parts: unknown): string | null => {
  const texts = Array.isArray(parts)
    ? parts.flatMap((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    : []
  const firstLine = texts
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  return firstLine === undefined ? null : firstLine.slice(0, promptCharacters)
}

/**
 * Reads a prompt typed into a session: the session is working, and the first prompt of a session
 * names it by its first line. Later prompts are never sent.
 * @param tracker What earlier events left.
 * @param sessionId The session the prompt went to.
 * @param parts The prompt's parts, as OpenCode's chat.message hook passes them.
 * @returns The new tracker and the report to send, if any.
 */
export const outcomeOfPrompt = (tracker: ReportTracker, sessionId: string, parts: unknown): EventOutcome => {
  if (isSubagent(tracker, sessionId)) return nothingFor(tracker)
  const firstLine = tracker.promptedSessions.has(sessionId) ? null : firstLineOf(parts)
  return {
    tracker: firstLine === null ? tracker : { ...tracker, promptedSessions: withAdded(tracker.promptedSessions, sessionId) },
    sessionReport: { type: 'chat.message', session_id: sessionId, ...(firstLine === null ? {} : { prompt: firstLine }) },
    tokenReport: null,
  }
}

/**
 * Reads the dashboard's address and ingest token from the config file dashi connect writes.
 * @param configText The file's contents.
 * @returns The settings, or null when the file is not a complete config.
 */
export const parseReporterSettings = (configText: string): ReporterSettings | null => {
  try {
    const parsed: unknown = JSON.parse(configText)
    if (!isRecord(parsed)) return null
    const dashboardUrl = textOf(parsed.dashboardUrl)
    const ingestToken = textOf(parsed.ingestToken)
    if (dashboardUrl === null || ingestToken === null || !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(dashboardUrl)) return null
    return { dashboardUrl: dashboardUrl.replace(/\/+$/, ''), ingestToken }
  } catch {
    return null
  }
}

/**
 * Where dashi connect writes the plugin's config.
 * @param environment The process environment; DASHI_HOME moves the folder, ~/dashi by default.
 * @returns The config file's path.
 */
export const reporterSettingsPathFor = (environment: NodeJS.ProcessEnv): string =>
  join(environment.DASHI_HOME ?? join(homedir(), 'dashi'), 'opencode.json')

const gitOutput = (directory: string, args: string[]): string | undefined => {
  try {
    return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

const headersFor = (settings: ReporterSettings, directory: string): Record<string, string> => {
  const optionalHeaders: Array<[string, string | undefined]> = [
    ['x-agent-branch', gitOutput(directory, ['rev-parse', '--abbrev-ref', 'HEAD'])],
    ['x-agent-remote', gitOutput(directory, ['remote', 'get-url', 'origin'])],
    ['x-agent-cwd', directory],
    ['x-dashi-start-id', process.env.DASHI_START_ID],
  ]
  return {
    authorization: `Bearer ${settings.ingestToken}`,
    'content-type': 'application/json',
    'x-agent-provider': 'opencode',
    ...Object.fromEntries(optionalHeaders.filter((header): header is [string, string] => header[1] !== undefined && header[1] !== '')),
  }
}

const post = (settings: ReporterSettings, directory: string, path: string, body: unknown): void => {
  fetch(`${settings.dashboardUrl}${path}`, {
    method: 'POST',
    headers: headersFor(settings, directory),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(reportTimeoutMilliseconds),
  }).catch(() => undefined)
}

const readReporterSettings = (): ReporterSettings | null => {
  try {
    return parseReporterSettings(readFileSync(reporterSettingsPathFor(process.env), 'utf8'))
  } catch {
    return null
  }
}

/**
 * The plugin OpenCode loads. Without a config from dashi connect it reports nothing.
 * @param input What OpenCode passes a plugin; only the session's folder is used.
 * @param input.directory The folder OpenCode runs in.
 * @returns The hooks: every event, and every prompt typed.
 */
export const DashiReporter = async ({ directory }: { directory: string }) => {
  const settings = readReporterSettings()
  // The one piece of state: what earlier events taught, replaced by each outcome.
  let tracker = emptyTracker()
  const send = (outcome: EventOutcome): void => {
    tracker = outcome.tracker
    if (settings === null) return
    if (outcome.sessionReport !== null) post(settings, outcome.sessionReport.cwd ?? directory, '/api/events', outcome.sessionReport)
    if (outcome.tokenReport !== null) post(settings, directory, '/api/telemetry/v1/metrics', outcome.tokenReport)
  }
  return {
    event: async ({ event }: { event: unknown }) => send(outcomeOfEvent(tracker, event)),
    'chat.message': async ({ sessionID }: { sessionID: string }, { parts }: { parts: unknown }) => send(outcomeOfPrompt(tracker, sessionID, parts)),
  }
}
