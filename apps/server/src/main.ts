import { mkdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createActivityStore } from './activity/activity-store.ts'
import { createMachineTokenStore } from './machine-tokens/machine-token-store.ts'
import { createApp } from './app/create-app.ts'
import { createGitHubAuthClient } from './auth/github-auth.ts'
import { createSessionStore } from './auth/session-store.ts'
import { createGithubGraphqlFetcher } from './github/board.ts'
import { createGithubRestFetcher } from './github/rest.ts'
import { createNetlifyFetcher } from './netlify/rest.ts'
import { loadRepositories } from './repos/load-repositories.ts'
import { fireRoutine } from './session-starts/routine.ts'
import { createRoutineStore, createSessionStartStore } from './session-starts/start-store.ts'
import { resolveRuntimeSettings } from './runtime/settings.ts'
import { parseEncodedKey } from './secrets/crypto.ts'
import { secretDefinitions } from './secrets/definitions.ts'
import { testSecretAgainstProvider } from './secrets/test-secret.ts'
import { createVault } from './secrets/vault.ts'

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))

const settingsResult = resolveRuntimeSettings({
  environment: process.env,
  readSecretFile: (filePath) => readFileSync(filePath, 'utf8'),
  defaultRepositoriesFile: join(workspaceRoot, 'config/repos.json'),
  defaultWebDistDirectory: join(workspaceRoot, 'apps/web/dist'),
})

if (!settingsResult.ok) {
  process.stderr.write(`dashi: ${settingsResult.reason}\n`)
  process.exit(1)
}

const { settings } = settingsResult
mkdirSync(settings.dataDirectory, { recursive: true })
const database = new DatabaseSync(join(settings.dataDirectory, 'dashboard.sqlite'))

const vault = createVault(database, {
  mode: settings.masterKeyEncoded === null ? 'passphrase' : 'environment',
  environmentKey: settings.masterKeyEncoded === null ? null : parseEncodedKey(settings.masterKeyEncoded),
})

const app = createApp({
  vault,
  auth: {
    sessionStore: createSessionStore(Date.now),
    githubSignIn:
      settings.githubSignIn === null
        ? null
        : { settings: settings.githubSignIn, client: createGitHubAuthClient(settings.githubSignIn) },
    signInRequired: settings.signInRequired,
    secureCookies: settings.secureCookies,
    now: Date.now,
  },
  sessionStarts: {
    startStore: createSessionStartStore(database, Date.now),
    routineStore: createRoutineStore(database),
    runnerTokens: createMachineTokenStore(database, Date.now, 'runner'),
    fireRoutine,
    runnerScriptPath: join(workspaceRoot, 'apps/runner/src/runner.ts'),
  },
  activity: {
    activityStore: createActivityStore(database),
    ingestTokens: createMachineTokenStore(database, Date.now, 'ingest'),
    now: Date.now,
  },
  repositories: loadRepositories(settings.repositoriesFile),
  secretDefinitions,
  testSecret: testSecretAgainstProvider,
  createGraphqlFetcher: createGithubGraphqlFetcher,
  createGithubRestFetcher,
  createNetlifyFetcher,
  mediaCacheDirectory: join(settings.dataDirectory, 'pr-media'),
  cliScriptPath: join(workspaceRoot, 'apps/cli/src/dashi.ts'),
  openCodeReporterPath: join(workspaceRoot, 'apps/opencode-plugin/src/opencode-reporter.ts'),
  allowedHostNames: settings.allowedHostNames,
  boardCacheMilliseconds: 60_000,
  now: Date.now,
})

const webRoot = relative(process.cwd(), settings.webDistDirectory)
app.use('/*', serveStatic({ root: webRoot }))
app.get('*', serveStatic({ path: join(webRoot, 'index.html') }))

const server = serve({ fetch: app.fetch, hostname: settings.host, port: settings.port }, (address) => {
  const signIn = settings.githubSignIn === null ? 'off' : settings.signInRequired ? 'required' : 'optional'
  process.stdout.write(
    `dashi (${settings.mode}) on port ${address.port}, open ${settings.publicUrl} (vault: ${vault.readState().mode}, GitHub sign-in: ${signIn})\n`,
  )
})

const shutDown = (): void => {
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)
