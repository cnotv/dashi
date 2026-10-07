import type { DatabaseSync } from 'node:sqlite'
import type { AgentProvider, AgentSessionState } from '@dashi/contracts'
import { sessionBillingOf } from './origin.ts'
import type { ActivityStore, AgentEvent, StoredEvent, StoredSession, StoredTokenSample, TokenType, TokenUsagePoint } from './types.ts'

const createSchema = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      repository_owner TEXT,
      repository_name TEXT,
      branch TEXT,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_event_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_session_events (
      session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_session_events_by_time ON agent_session_events (occurred_at);
    CREATE TABLE IF NOT EXISTS token_usage_series (
      series_key TEXT PRIMARY KEY,
      tokens INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS token_usage_samples (
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      token_type TEXT NOT NULL,
      tokens INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS token_usage_samples_by_time ON token_usage_samples (recorded_at);
  `)
  // Added after the first release; a database from before gets the columns on start.
  const sessionColumns = database.prepare('PRAGMA table_info(agent_sessions)').all().map((column) => String(column.name))
  const addedColumns = ['title', 'folder', 'launcher', 'terminal_app', 'launching_app', 'billing', 'api_host', 'start_id']
  addedColumns
    .filter((column) => !sessionColumns.includes(column))
    .forEach((column) => database.exec(`ALTER TABLE agent_sessions ADD COLUMN ${column} TEXT`))
  const sampleColumns = database.prepare('PRAGMA table_info(token_usage_samples)').all().map((column) => String(column.name))
  const addedSampleColumns = ['machine_token_id', 'account', 'launch_hint']
  addedSampleColumns
    .filter((column) => !sampleColumns.includes(column))
    .forEach((column) => database.exec(`ALTER TABLE token_usage_samples ADD COLUMN ${column} TEXT`))
}

const agentSessionStates: AgentSessionState[] = ['working', 'waiting', 'idle', 'ended', 'inactive']
const tokenTypes: TokenType[] = ['input', 'output', 'cacheRead', 'cacheCreation']

const toProvider = (value: string): AgentProvider => (value === 'codex' ? 'codex' : 'claude')
const toState = (value: string): AgentSessionState => agentSessionStates.find((state) => state === value) ?? 'idle'
const toTokenType = (value: string): TokenType => tokenTypes.find((tokenType) => tokenType === value) ?? 'input'

const readText = (row: Record<string, unknown>, column: string): string => String(row[column] ?? '')
const readOptionalText = (row: Record<string, unknown>, column: string): string | null =>
  typeof row[column] === 'string' ? row[column] : null

const toStoredSession = (row: Record<string, unknown>): StoredSession => {
  const owner = readOptionalText(row, 'repository_owner')
  const name = readOptionalText(row, 'repository_name')
  return {
    sessionId: readText(row, 'session_id'),
    provider: toProvider(readText(row, 'provider')),
    repository: owner !== null && name !== null ? { owner, name } : null,
    branch: readOptionalText(row, 'branch'),
    title: readOptionalText(row, 'title'),
    folder: readOptionalText(row, 'folder'),
    origin: {
      launcher: readOptionalText(row, 'launcher'),
      terminal: readOptionalText(row, 'terminal_app'),
      launchingApp: readOptionalText(row, 'launching_app'),
      billing: sessionBillingOf(row.billing),
      apiHost: readOptionalText(row, 'api_host'),
      startId: readOptionalText(row, 'start_id'),
    },
    state: toState(readText(row, 'state')),
    startedAt: readText(row, 'started_at'),
    lastEventAt: readText(row, 'last_event_at'),
  }
}

// A cumulative series reports its running total each time; only the growth since the last
// report is new usage. A series restarted by the exporter comes with a new start time, so it
// gets a new key and starts from zero.
const seriesKeyOf = (point: TokenUsagePoint): string =>
  [point.sessionId, point.model, point.tokenType, point.seriesStart].join('|')

/**
 * Creates the store of session events and token usage on a SQLite database.
 * @param database The database; its tables are created when missing.
 * @returns The activity store.
 */
export const createActivityStore = (database: DatabaseSync): ActivityStore => {
  createSchema(database)
  const upsertSession = database.prepare(`
    INSERT INTO agent_sessions (session_id, provider, repository_owner, repository_name, branch, title, folder, state, started_at, last_event_at,
      launcher, terminal_app, launching_app, billing, api_host, start_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      state = excluded.state,
      last_event_at = excluded.last_event_at,
      repository_owner = COALESCE(excluded.repository_owner, agent_sessions.repository_owner),
      repository_name = COALESCE(excluded.repository_name, agent_sessions.repository_name),
      branch = COALESCE(excluded.branch, agent_sessions.branch),
      title = COALESCE(agent_sessions.title, excluded.title),
      folder = COALESCE(excluded.folder, agent_sessions.folder),
      launcher = COALESCE(excluded.launcher, agent_sessions.launcher),
      terminal_app = COALESCE(excluded.terminal_app, agent_sessions.terminal_app),
      launching_app = COALESCE(excluded.launching_app, agent_sessions.launching_app),
      billing = COALESCE(excluded.billing, agent_sessions.billing),
      api_host = COALESCE(excluded.api_host, agent_sessions.api_host),
      start_id = COALESCE(excluded.start_id, agent_sessions.start_id)
  `)
  const insertEvent = database.prepare('INSERT INTO agent_session_events (session_id, state, occurred_at) VALUES (?, ?, ?)')
  const readSeries = database.prepare('SELECT tokens FROM token_usage_series WHERE series_key = ?')
  const writeSeries = database.prepare(
    'INSERT INTO token_usage_series (series_key, tokens) VALUES (?, ?) ON CONFLICT(series_key) DO UPDATE SET tokens = excluded.tokens',
  )
  const insertSample = database.prepare(
    `INSERT INTO token_usage_samples (session_id, model, token_type, tokens, recorded_at, machine_token_id, account, launch_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const newTokensOf = (point: TokenUsagePoint): number => {
    if (!point.isCumulative) return point.value
    const seriesKey = seriesKeyOf(point)
    const previousRow = readSeries.get(seriesKey)
    const previousTokens = typeof previousRow?.tokens === 'number' ? previousRow.tokens : 0
    writeSeries.run(seriesKey, point.value)
    return Math.max(0, point.value - previousTokens)
  }

  return {
    recordEvent: (event: AgentEvent) => {
      upsertSession.run(
        event.sessionId,
        event.provider,
        event.repository?.owner ?? null,
        event.repository?.name ?? null,
        event.branch,
        event.title,
        event.folder,
        event.state,
        event.occurredAt,
        event.occurredAt,
        event.origin.launcher,
        event.origin.terminal,
        event.origin.launchingApp,
        event.origin.billing,
        event.origin.apiHost,
        event.origin.startId,
      )
      insertEvent.run(event.sessionId, event.state, event.occurredAt)
    },
    recordTokenUsage: (points, machineTokenId) => {
      database.exec('BEGIN')
      try {
        points
          .map((point) => ({ point, newTokens: newTokensOf(point) }))
          .filter(({ newTokens }) => newTokens > 0)
          .forEach(({ point, newTokens }) =>
            insertSample.run(
              point.sessionId,
              point.model,
              point.tokenType,
              newTokens,
              point.observedAt,
              machineTokenId,
              point.account,
              point.launchHint,
            ),
          )
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
    readSessions: () => database.prepare('SELECT * FROM agent_sessions').all().map(toStoredSession),
    readEventsSince: (since) =>
      database
        .prepare('SELECT session_id, state, occurred_at FROM agent_session_events WHERE occurred_at >= ? ORDER BY occurred_at')
        .all(since)
        .map(
          (row): StoredEvent => ({
            sessionId: readText(row, 'session_id'),
            state: toState(readText(row, 'state')),
            occurredAt: readText(row, 'occurred_at'),
          }),
        ),
    readTokenSamplesSince: (since) =>
      database
        .prepare('SELECT * FROM token_usage_samples WHERE recorded_at >= ? ORDER BY rowid')
        .all(since)
        .map(
          (row): StoredTokenSample => ({
            sessionId: readText(row, 'session_id'),
            model: readText(row, 'model'),
            tokenType: toTokenType(readText(row, 'token_type')),
            tokens: Number(row.tokens ?? 0),
            recordedAt: readText(row, 'recorded_at'),
            machineTokenId: readOptionalText(row, 'machine_token_id'),
            account: readOptionalText(row, 'account'),
            launchHint: readOptionalText(row, 'launch_hint'),
          }),
        ),
  }
}
