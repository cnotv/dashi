import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RepositoryReference, SessionStart, SessionStartState, StartTarget } from '@dashi/contracts'
import { sessionStartRequestSchema } from './schema.ts'
import type { RoutineStore, SessionStartStore } from './types.ts'

const recentStartCount = 50
const laptopTargets: StartTarget[] = ['laptop-remote-control', 'laptop-headless', 'laptop-cloud']
const startStates: SessionStartState[] = ['queued', 'claimed', 'started', 'failed']

const readOptionalText = (row: Record<string, unknown>, column: string): string | null =>
  typeof row[column] === 'string' ? row[column] : null

// The request is kept as the JSON the dashboard accepted, and read back through the same schema,
// so a row can never hand the runner anything the Start dialog could not have sent.
const toSessionStart = (row: Record<string, unknown>): SessionStart | null => {
  const parsedRequest = sessionStartRequestSchema.safeParse(JSON.parse(String(row.request_json ?? 'null')))
  const state = startStates.find((startState) => startState === row.state)
  if (!parsedRequest.success || state === undefined) return null
  return {
    ...parsedRequest.data,
    startId: String(row.start_id),
    state,
    runnerLabel: readOptionalText(row, 'runner_label'),
    sessionUrl: readOptionalText(row, 'session_url'),
    message: readOptionalText(row, 'message'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

const startsOfRow = (row: Record<string, unknown>): SessionStart[] => {
  const start = toSessionStart(row)
  return start === null ? [] : [start]
}

/**
 * Creates the store of sessions started from the board: queued for a laptop runner, or fired at a routine.
 * @param database The database; its table is created when missing.
 * @param now The clock.
 * @returns The store.
 */
export const createSessionStartStore = (database: DatabaseSync, now: () => number): SessionStartStore => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_starts (
      start_id TEXT PRIMARY KEY,
      request_json TEXT NOT NULL,
      target TEXT NOT NULL,
      state TEXT NOT NULL,
      runner_label TEXT,
      session_url TEXT,
      message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_starts_by_time ON session_starts (created_at);
  `)
  const nowIso = (): string => new Date(now()).toISOString()
  const readStart = (startId: string): SessionStart | null =>
    toSessionStart(database.prepare('SELECT * FROM session_starts WHERE start_id = ?').get(startId) ?? {})

  const requireStart = (startId: string): SessionStart => {
    const start = readStart(startId)
    if (start === null) throw new Error(`Session start ${startId} is missing`)
    return start
  }

  return {
    createStart: (request) => {
      const startId = randomUUID()
      const createdAt = nowIso()
      database
        .prepare('INSERT INTO session_starts (start_id, request_json, target, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(startId, JSON.stringify(request), request.target, 'queued', createdAt, createdAt)
      return requireStart(startId)
    },
    listRecentStarts: () =>
      database
        .prepare('SELECT * FROM session_starts ORDER BY created_at DESC LIMIT ?')
        .all(recentStartCount)
        .flatMap(startsOfRow),
    listStartsSince: (since) =>
      database
        .prepare('SELECT * FROM session_starts WHERE created_at >= ? ORDER BY created_at DESC')
        .all(since)
        .flatMap(startsOfRow),
    readStart,
    // The oldest queued laptop start goes to whichever runner asks first; the state check in
    // the UPDATE keeps two runners asking at once from both getting it.
    claimNextLaptopStart: (runnerLabel) => {
      const placeholders = laptopTargets.map(() => '?').join(', ')
      const nextRow = database
        .prepare(`SELECT start_id FROM session_starts WHERE state = 'queued' AND target IN (${placeholders}) ORDER BY created_at LIMIT 1`)
        .get(...laptopTargets)
      if (nextRow === undefined) return null
      const claimResult = database
        .prepare(`UPDATE session_starts SET state = 'claimed', runner_label = ?, updated_at = ? WHERE start_id = ? AND state = 'queued'`)
        .run(runnerLabel, nowIso(), String(nextRow.start_id))
      return claimResult.changes === 1 ? readStart(String(nextRow.start_id)) : null
    },
    recordRunnerReport: (startId, runnerLabel, report) => {
      const updateResult = database
        .prepare(
          `UPDATE session_starts SET state = ?, session_url = ?, message = ?, updated_at = ?
           WHERE start_id = ? AND runner_label = ? AND state = 'claimed'`,
        )
        .run(report.state, report.sessionUrl, report.message, nowIso(), startId, runnerLabel)
      return updateResult.changes === 1 ? readStart(startId) : null
    },
    // A start a runner is launching, or one that ran, stays: usage reads it to tell the sessions
    // the board started, and the runner's report would find nothing to land on.
    discardUnstartedStart: (startId) =>
      database.prepare(`DELETE FROM session_starts WHERE start_id = ? AND state IN ('queued', 'failed')`).run(startId).changes === 1,
    recordOutcome: (startId, outcome) => {
      database
        .prepare('UPDATE session_starts SET state = ?, session_url = ?, message = ?, updated_at = ? WHERE start_id = ?')
        .run(outcome.state, outcome.sessionUrl, outcome.message, nowIso(), startId)
      return requireStart(startId)
    },
  }
}

/**
 * Creates the store of each repository's Claude Code routine; its token lives in the vault.
 * @param database The database; its table is created when missing.
 * @returns The store.
 */
export const createRoutineStore = (database: DatabaseSync): RoutineStore => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS repository_routines (
      repository_key TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL
    );
  `)
  const keyOf = (repository: RepositoryReference): string => `${repository.owner}/${repository.name}`.toLowerCase()
  return {
    readRoutineId: (repository) => {
      const row = database.prepare('SELECT routine_id FROM repository_routines WHERE repository_key = ?').get(keyOf(repository))
      return typeof row?.routine_id === 'string' ? row.routine_id : null
    },
    saveRoutineId: (repository, routineId) => {
      database
        .prepare('INSERT INTO repository_routines (repository_key, routine_id) VALUES (?, ?) ON CONFLICT(repository_key) DO UPDATE SET routine_id = excluded.routine_id')
        .run(keyOf(repository), routineId)
    },
    deleteRoutineId: (repository) => {
      database.prepare('DELETE FROM repository_routines WHERE repository_key = ?').run(keyOf(repository))
    },
  }
}
