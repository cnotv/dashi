import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'
import { normaliseUserCode } from './pairing-relay.ts'

const createdPairingSchema = z.object({ pairingId: z.string(), userCode: z.string(), pollSecret: z.string(), approvePath: z.string() })
const approvedSchema = z.object({ state: z.literal('approved'), label: z.string(), ingestToken: z.string(), runnerToken: z.string().nullable() })

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const createPairing = async (app: ReturnType<typeof createTestApp>['app']) =>
  createdPairingSchema.parse(await (await app.request(jsonRequest('POST', '/api/pairings', { hostname: 'mac-mini.local', platform: 'macos' }))).json())
const pollRequest = (pairingId: string, pollSecret: string) => getRequest(`/api/pairings/${pairingId}`, bearer(pollSecret))

describe('pairing a machine', () => {
  it('hands the approved tokens to the CLI that asked, once', async () => {
    const { app } = createTestApp()
    const pairing = await createPairing(app)
    expect(pairing.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(pairing.approvePath).toBe(`/pair?code=${pairing.userCode}`)
    expect(await (await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).json()).toEqual({ state: 'pending' })

    const described = await (await app.request(getRequest(`/api/pairing-requests/${pairing.userCode.toLowerCase().replace('-', '')}`))).json()
    expect(described).toMatchObject({ userCode: pairing.userCode, hostname: 'mac-mini.local', platform: 'macos' })
    const approval = { userCode: pairing.userCode, label: 'Mac mini', withRunner: true }
    expect((await app.request(jsonRequest('POST', '/api/pairing-requests/approve', approval))).status).toBe(204)

    const approved = approvedSchema.parse(await (await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).json())
    expect(approved.label).toBe('Mac mini')
    expect(approved.runnerToken).not.toBeNull()
    expect((await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).status).toBe(404)

    expect(await (await app.request(getRequest('/api/machine/whoami', bearer(approved.ingestToken)))).json()).toMatchObject({ kind: 'ingest', label: 'Mac mini' })
    expect(await (await app.request(getRequest('/api/machine/whoami', bearer(approved.runnerToken ?? '')))).json()).toMatchObject({ kind: 'runner' })
  })

  it('makes no runner token unless asked, and approves a code only once', async () => {
    const { app } = createTestApp()
    const pairing = await createPairing(app)
    await app.request(jsonRequest('POST', '/api/pairing-requests/approve', { userCode: pairing.userCode, label: 'Laptop', withRunner: false }))
    const second = await app.request(jsonRequest('POST', '/api/pairing-requests/approve', { userCode: pairing.userCode, label: 'Other', withRunner: false }))
    expect(second.status).toBe(404)
    expect(approvedSchema.parse(await (await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).json()).runnerToken).toBeNull()
  })

  it('refuses a poll without the secret, and a pairing past ten minutes', async () => {
    const clock = { now: 0 }
    const { app } = createTestApp({}, {}, clock)
    const pairing = await createPairing(app)
    expect((await app.request(pollRequest(pairing.pairingId, 'wrong-secret'))).status).toBe(401)
    clock.now = 11 * 60_000
    expect((await app.request(getRequest(`/api/pairing-requests/${pairing.userCode}`))).status).toBe(404)
    expect((await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).status).toBe(410)
  })

  it('lets a CLI pair without signing in, but only a signed-in person approve', async () => {
    const { app } = createTestApp({}, { signInRequired: true })
    const pairing = await createPairing(app)
    expect((await app.request(pollRequest(pairing.pairingId, pairing.pollSecret))).status).toBe(200)
    expect((await app.request(getRequest(`/api/pairing-requests/${pairing.userCode}`))).status).toBe(401)
    const approval = { userCode: pairing.userCode, label: 'Mac', withRunner: false }
    expect((await app.request(jsonRequest('POST', '/api/pairing-requests/approve', approval))).status).toBe(401)
  })

  it('refuses a hostname that is not plain text', async () => {
    const { app } = createTestApp()
    expect((await app.request(jsonRequest('POST', '/api/pairings', { hostname: '<script>', platform: 'macos' }))).status).toBe(400)
  })

  it('reads a code typed in lower case or without its dash', () => {
    expect(normaliseUserCode('abcd2345')).toBe('ABCD-2345')
    expect(normaliseUserCode('ABCD-2345')).toBe('ABCD-2345')
  })
})

describe('a machine and its own token', () => {
  it('revokes its own token and nothing else', async () => {
    const { app, ingestTokens, runnerTokens } = createTestApp()
    const { token: ingestToken } = ingestTokens.createToken('Laptop')
    const { token: runnerToken } = runnerTokens.createToken('Laptop')
    expect((await app.request(new Request('http://localhost:4317/api/machine/whoami', { method: 'DELETE', headers: { host: 'localhost:4317', 'content-type': 'application/json', ...bearer(ingestToken) } }))).status).toBe(204)
    expect((await app.request(getRequest('/api/machine/whoami', bearer(ingestToken)))).status).toBe(401)
    expect((await app.request(getRequest('/api/machine/whoami', bearer(runnerToken)))).status).toBe(200)
  })
})

describe('the CLI file', () => {
  it('describes the file it serves with its hash, without a sign-in', async () => {
    const { app } = createTestApp({}, { signInRequired: true })
    const script = await (await app.request(getRequest('/api/cli/script'))).text()
    const info = z.object({ sha256: z.string(), byteLength: z.number(), sourcePath: z.string() }).parse(await (await app.request(getRequest('/api/cli/script-info'))).json())
    expect(script).toContain('dashi connect')
    expect(info).toEqual({ sha256: createHash('sha256').update(script).digest('hex'), byteLength: Buffer.byteLength(script), sourcePath: 'apps/cli/src/dashi.ts' })
  })

  it('serves the OpenCode reporter the same way, for dashi connect to install', async () => {
    const { app } = createTestApp({}, { signInRequired: true })
    const reporterResponse = await app.request(getRequest('/api/cli/opencode-reporter'))
    expect(reporterResponse.headers.get('content-disposition')).toBe('attachment; filename="opencode-reporter.ts"')
    const reporter = await reporterResponse.text()
    const info = z
      .object({ sha256: z.string(), byteLength: z.number(), sourcePath: z.string() })
      .parse(await (await app.request(getRequest('/api/cli/opencode-reporter-info'))).json())
    expect(reporter).toContain('export const DashiReporter')
    expect(info).toEqual({
      sha256: createHash('sha256').update(reporter).digest('hex'),
      byteLength: Buffer.byteLength(reporter),
      sourcePath: 'apps/opencode-plugin/src/opencode-reporter.ts',
    })
  })
})
