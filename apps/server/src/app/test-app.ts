import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import boardResponseFixture from '../github/fixtures/board-response.json' with { type: 'json' }
import { createActivityStore } from '../activity/activity-store.ts'
import { createMachineTokenStore } from '../machine-tokens/machine-token-store.ts'
import { createSessionStore } from '../auth/session-store.ts'
import type { AuthDependencies } from '../auth/types.ts'
import { generateKeyMaterial } from '../secrets/crypto.ts'
import { secretDefinitions } from '../secrets/definitions.ts'
import { createVault } from '../secrets/vault.ts'
import { createRoutineStore, createSessionStartStore } from '../session-starts/start-store.ts'
import { createApp } from './create-app.ts'
import type { AppDependencies, ReceivedRestRequest } from './types.ts'

export const testHost = 'localhost:4317'

export const signedVideoUrl = 'https://private-user-images.githubusercontent.com/1/video.mp4?jwt=signed'

const pullRequestBodyHtmlFixture = {
  data: {
    repository: {
      pullRequest: { bodyHTML: `<p>Closes #4</p><video src="${signedVideoUrl}" controls="controls"></video>` },
    },
  },
}

/**
 * Builds the app on an in-memory database with a fake GitHub that records every token and REST request it is given.
 * @param overrides App dependencies to replace for one test.
 * @param authOverrides Auth settings to replace, such as requiring sign-in.
 * @param clock The time the activity routes see; a test moves it by changing now.
 * @param restResponses The answer the fake GitHub REST API gives for each path; any other path is a 404.
 * @returns The app, its vault, database, activity and start stores, the runner tokens, the routines fired, and the tokens and REST requests GitHub received.
 */
export const createTestApp = (
  overrides: Partial<AppDependencies> = {},
  authOverrides: Partial<AuthDependencies> = {},
  clock: { now: number } = { now: 0 },
  restResponses: Record<string, Response> = {},
) => {
  const database = new DatabaseSync(':memory:')
  const activityStore = createActivityStore(database)
  const ingestTokens = createMachineTokenStore(database, () => clock.now, 'ingest')
  const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
  const runnerTokens = createMachineTokenStore(database, () => clock.now, 'runner')
  const startStore = createSessionStartStore(database, () => clock.now)
  const firedRoutines: { routineId: string; routineToken: string; text: string }[] = []
  const receivedTokens: string[] = []
  const receivedRestRequests: ReceivedRestRequest[] = []
  const app = createApp({
    vault,
    auth: {
      sessionStore: createSessionStore(() => 0),
      githubSignIn: null,
      signInRequired: false,
      secureCookies: false,
      now: () => 0,
      ...authOverrides,
    },
    activity: { activityStore, ingestTokens, now: () => clock.now },
    sessionStarts: {
      startStore,
      routineStore: createRoutineStore(database),
      runnerTokens,
      fireRoutine: async (routineId, routineToken, text) => {
        firedRoutines.push({ routineId, routineToken, text })
        return { ok: true, sessionUrl: 'https://claude.ai/code/session_01Fired' }
      },
      runnerScriptPath: fileURLToPath(new URL('../../../runner/src/runner.ts', import.meta.url)),
    },
    repositories: [{ owner: 'cnotv', name: 'generative-art' }],
    secretDefinitions,
    testSecret: async () => ({ ok: true, status: 200, message: 'The provider accepted the key' }),
    createGraphqlFetcher: (token) => async (query) => {
      receivedTokens.push(token)
      return query.includes('bodyHTML') ? pullRequestBodyHtmlFixture : boardResponseFixture
    },
    createGithubRestFetcher: (token) => async (path, request = { method: 'GET' }) => {
      receivedTokens.push(token)
      receivedRestRequests.push({ path, ...request })
      return restResponses[path] ?? new Response('{}', { status: 404 })
    },
    createNetlifyFetcher: () => async () => new Response('{}', { status: 404 }),
    mediaCacheDirectory: mkdtempSync(join(tmpdir(), 'dashi-media-')),
    cliScriptPath: fileURLToPath(new URL('../../../cli/src/dashi.ts', import.meta.url)),
    openCodeReporterPath: fileURLToPath(new URL('../../../opencode-plugin/src/opencode-reporter.ts', import.meta.url)),
    allowedHostNames: ['localhost', '127.0.0.1'],
    boardCacheMilliseconds: 60_000,
    now: () => clock.now,
    ...overrides,
  })
  return { app, vault, database, receivedTokens, receivedRestRequests, activityStore, ingestTokens, runnerTokens, startStore, firedRoutines }
}

/**
 * Builds a request with a JSON body and an allowed Host header, as the browser would send it.
 * @param method The HTTP method.
 * @param path The path, starting with /api.
 * @param body The value sent as JSON.
 * @param extraHeaders Headers added to or replacing the defaults.
 * @returns The request, ready for app.request.
 */
export const jsonRequest = (method: string, path: string, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request(`http://${testHost}${path}`, {
    method,
    headers: { host: testHost, 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })

/**
 * Builds a GET request with an allowed Host header.
 * @param path The path, starting with /api.
 * @param extraHeaders Headers added to or replacing the defaults.
 * @returns The request, ready for app.request.
 */
export const getRequest = (path: string, extraHeaders: Record<string, string> = {}) =>
  new Request(`http://${testHost}${path}`, { headers: { host: testHost, ...extraHeaders } })

/**
 * A fake GitHub GraphQL API for pull request draft changes: it answers the draft state query
 * with one pull request and records every query and its variables.
 * @param isDraft Whether the pull request is a draft now.
 * @param mutationAnswer What GitHub answers the mutation with, such as a refusal.
 * @returns The fetcher factory to pass as createGraphqlFetcher, and the calls it received.
 */
export const createDraftGithub = (isDraft: boolean, mutationAnswer: unknown = { data: {} }) => {
  const receivedCalls: { query: string; variables: Record<string, string | number> }[] = []
  const createGraphqlFetcher: AppDependencies['createGraphqlFetcher'] = () => async (query, variables) => {
    receivedCalls.push({ query, variables })
    return query.includes('PullRequestDraftState') ? { data: { repository: { pullRequest: { id: 'PR_kwDraft', isDraft } } } } : mutationAnswer
  }
  return { createGraphqlFetcher, receivedCalls }
}
