import { Hono } from 'hono'
import type { MachineIdentity, MachineTokenKind, MachineTokenSummary, PairingDescription, PairingPoll } from '@dashi/contracts'
import { bearerTokenOf, limitTo, readJsonBody } from '../app/http.ts'
import type { AppEnvironment } from '../app/types.ts'
import { addServedScriptRoutes } from '../app/served-script.ts'
import { pairingApprovalSchema, pairingRequestSchema } from './schema.ts'
import type { MachineRouteDependencies } from './types.ts'

// Reached by the CLI rather than a browser, so these carry no sign-in: making a pairing and
// polling it with the secret only its CLI holds, a machine checking or revoking its own token,
// and the files the CLI installs: itself and the OpenCode reporter. Approving a pairing is not among them.
export const machineApiPathPrefixes = ['/api/pairings', '/api/machine/', '/api/cli/']

/**
 * Builds the routes that connect a machine: the pairing a CLI asks for and the person approves,
 * a machine's view of its own tokens, and the files the CLI installs, each with its hash.
 * @param dependencies The pairing relay, both token stores and where the CLI and OpenCode reporter files are.
 * @returns The routes, mounted under /api.
 */
export const createMachineRoutes = ({ pairingRelay, ingestTokens, runnerTokens, cliScriptPath, openCodeReporterPath }: MachineRouteDependencies) => {
  const routes = new Hono<AppEnvironment>()

  const tokenOf = (authorizationHeader: string | undefined): { kind: MachineTokenKind; token: MachineTokenSummary } | null => {
    const presentedToken = bearerTokenOf(authorizationHeader)
    const ingestToken = ingestTokens.verifyToken(presentedToken)
    if (ingestToken !== null) return { kind: 'ingest', token: ingestToken }
    const runnerToken = runnerTokens.verifyToken(presentedToken)
    return runnerToken === null ? null : { kind: 'runner', token: runnerToken }
  }

  routes.post('/pairings', limitTo(4 * 1024), async (context) => {
    const request = pairingRequestSchema.parse(await readJsonBody(context.req.raw))
    const pairing = pairingRelay.create(request)
    return pairing === null ? context.json({ error: 'Too many machines are waiting to be approved; try again in a few minutes' }, 429) : context.json(pairing, 201)
  })

  routes.get('/pairings/:pairingId', (context) => {
    const result = pairingRelay.poll(context.req.param('pairingId'), bearerTokenOf(context.req.header('authorization')) ?? '')
    if (result.outcome === 'unknown') return context.json({ error: 'Unknown pairing' }, 404)
    if (result.outcome === 'refused') return context.json({ error: 'Send the pairing secret' }, 401)
    if (result.outcome === 'expired') return context.json({ error: 'The pairing expired; run dashi connect again' }, 410)
    return context.json<PairingPoll>(result.poll)
  })

  routes.get('/pairing-requests/:userCode', (context) => {
    const description = pairingRelay.describe(context.req.param('userCode'))
    return description === null ? context.json({ error: 'No machine is waiting with that code' }, 404) : context.json<PairingDescription>(description)
  })

  // The tokens are made only here, by a signed-in person, and go to the CLI through the pairing.
  routes.post('/pairing-requests/approve', async (context) => {
    const { userCode, label, withRunner } = pairingApprovalSchema.parse(await readJsonBody(context.req.raw))
    if (pairingRelay.describe(userCode) === null) return context.json({ error: 'No machine is waiting with that code' }, 404)
    const ingestToken = ingestTokens.createToken(label).token
    const runnerToken = withRunner ? runnerTokens.createToken(label).token : null
    pairingRelay.approve(userCode, { label, ingestToken, runnerToken })
    return context.body(null, 204)
  })

  routes.get('/machine/whoami', (context) => {
    const presented = tokenOf(context.req.header('authorization'))
    if (presented === null) return context.json({ error: 'Send a valid machine token' }, 401)
    return context.json<MachineIdentity>({ kind: presented.kind, label: presented.token.label, lastUsedAt: presented.token.lastUsedAt })
  })

  routes.delete('/machine/whoami', (context) => {
    const presented = tokenOf(context.req.header('authorization'))
    if (presented === null) return context.json({ error: 'Send a valid machine token' }, 401)
    const tokenStore = presented.kind === 'ingest' ? ingestTokens : runnerTokens
    tokenStore.revokeToken(presented.token.tokenId)
    return context.body(null, 204)
  })

  addServedScriptRoutes(routes, { path: '/cli/script', filePath: cliScriptPath, fileName: 'dashi.ts', sourcePath: 'apps/cli/src/dashi.ts' })
  addServedScriptRoutes(routes, {
    path: '/cli/opencode-reporter',
    filePath: openCodeReporterPath,
    fileName: 'opencode-reporter.ts',
    sourcePath: 'apps/opencode-plugin/src/opencode-reporter.ts',
  })

  return routes
}
