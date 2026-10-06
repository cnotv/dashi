import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createDraftGithub, createTestApp, getRequest, jsonRequest, signedVideoUrl, testHost } from './test-app.ts'
import { z } from 'zod'
import { secretDefinitions } from '../secrets/definitions.ts'

const sampleToken = 'ghp_exampleTokenValue1234567890abcd'
const host = testHost

describe('secrets routes', () => {
  it('stores a secret and never returns its value from any route', async () => {
    const { app } = createTestApp()
    const saveResponse = await app.request(jsonRequest('POST', '/api/secrets/github-token/entries', { label: 'Personal', value: sampleToken }))
    expect(saveResponse.status).toBe(201)

    const responseBodies = await Promise.all(
      ['/api/secrets', '/api/vault', '/api/repositories', '/api/repositories/cnotv/generative-art/board'].map(async (path) =>
        (await app.request(getRequest(path))).text(),
      ),
    )
    const testBody = await (await app.request(jsonRequest('POST', '/api/secrets/github-token/entries/default/test', {}))).text()
    ;[...responseBodies, testBody].forEach((responseBody) => expect(responseBody).not.toContain(sampleToken))
    expect(JSON.parse(responseBodies[0] ?? '[]')).toContainEqual(
      expect.objectContaining({
        name: 'github-token',
        entries: [expect.objectContaining({ entryId: 'default', label: 'Personal', lastFour: 'abcd', isInUse: true })],
      }),
    )
  })

  it('adds a second token, switches to it, renames and removes it', async () => {
    const { app, vault } = createTestApp()
    await app.request(jsonRequest('POST', '/api/secrets/github-token/entries', { label: 'Personal', value: sampleToken }))
    const created = await app.request(jsonRequest('POST', '/api/secrets/github-token/entries', { label: 'Work', value: 'ghp_workToken0000000000000000000000000002' }))
    const { entryId } = z.object({ entryId: z.string() }).parse(await created.json())
    expect(vault.readSecretValue('github-token')).toBe(sampleToken)
    expect((await app.request(jsonRequest('POST', `/api/secrets/github-token/entries/${entryId}/use`, {}))).status).toBe(204)
    expect(vault.readSecretValue('github-token')).toBe('ghp_workToken0000000000000000000000000002')
    expect((await app.request(jsonRequest('PATCH', `/api/secrets/github-token/entries/${entryId}`, { label: 'Client' }))).status).toBe(204)
    expect(vault.listSecrets(secretDefinitions)[0]?.entries[1]?.label).toBe('Client')
    expect((await app.request(jsonRequest('DELETE', `/api/secrets/github-token/entries/${entryId}`, {}))).status).toBe(204)
    expect(vault.readSecretValue('github-token')).toBe(sampleToken)
  })

  it('refuses unknown credential names and tokens', async () => {
    const { app } = createTestApp()
    expect((await app.request(jsonRequest('POST', '/api/secrets/anything/entries', { value: 'x' }))).status).toBe(404)
    expect((await app.request(jsonRequest('POST', '/api/secrets/github-token/entries/nope/test', {}))).status).toBe(404)
  })

  it('redacts a secret value that appears in an error message', async () => {
    const { app, vault } = createTestApp({
      createGraphqlFetcher: (token) => async () => {
        throw new Error(`request failed for ${token}`)
      },
    })
    vault.saveSecret('github-token', sampleToken)
    const errorBody = await (await app.request(getRequest('/api/repositories/cnotv/generative-art/board'))).text()
    expect(errorBody).toContain('[redacted]')
    expect(errorBody).not.toContain(sampleToken)
  })
})

describe('request guards', () => {
  it('rejects an unknown host header', async () => {
    const { app } = createTestApp()
    const response = await app.request(new Request('http://attacker.example/api/vault', { headers: { host: 'attacker.example' } }))
    expect(response.status).toBe(403)
  })

  it('rejects a cross-origin mutation', async () => {
    const { app } = createTestApp()
    const response = await app.request(
      jsonRequest('PUT', '/api/secrets/github-token', { value: sampleToken }, { origin: 'https://attacker.example' }),
    )
    expect(response.status).toBe(403)
  })

  it('sends security headers, without HSTS over plain http', async () => {
    const { app } = createTestApp()
    const response = await app.request(getRequest('/api/health'))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('strict-transport-security')).toBeNull()
  })

  it('sends HSTS behind https', async () => {
    const { app } = createTestApp({}, { secureCookies: true })
    const response = await app.request(getRequest('/api/health'))
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
  })

  it('rejects a mutation that is not JSON', async () => {
    const { app } = createTestApp()
    const response = await app.request(
      new Request(`http://${host}/api/vault/lock`, { method: 'POST', headers: { host, 'content-type': 'text/plain' }, body: 'x' }),
    )
    expect(response.status).toBe(415)
  })
})

describe('board route', () => {
  it('asks for a GitHub token first', async () => {
    const { app } = createTestApp()
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/board'))).status).toBe(412)
  })

  it('returns the board using the stored token and caches it', async () => {
    const { app, vault, receivedTokens } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    const firstResponse = await app.request(getRequest('/api/repositories/cnotv/generative-art/board'))
    await app.request(getRequest('/api/repositories/cnotv/generative-art/board'))
    expect(firstResponse.status).toBe(200)
    // One GraphQL call for the board and one REST call for its recordings, both with the token.
    expect(receivedTokens).toEqual([sampleToken, sampleToken])
    await app.request(getRequest('/api/repositories/cnotv/generative-art/board?refresh=1'))
    expect(receivedTokens).toHaveLength(4)
  })

  it('refuses a repository that is not configured', async () => {
    const { app } = createTestApp()
    expect((await app.request(getRequest('/api/repositories/someone/else/board'))).status).toBe(404)
  })
})

describe('pull request media route', () => {
  const mediaPath = (kind: string) => `/api/repositories/cnotv/generative-art/pulls/7/media/${kind}`

  it('sends the browser to the signed GitHub link, and reuses the rendered body for a while', async () => {
    const { app, vault, receivedTokens } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(getRequest(mediaPath('video')))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(signedVideoUrl)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await app.request(getRequest(mediaPath('video')))
    expect(receivedTokens).toHaveLength(1)
  })

  it('answers 404 for a kind the body does not have, or one that does not exist', async () => {
    const { app, vault } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(getRequest(mediaPath('image')))).status).toBe(404)
    expect((await app.request(getRequest(mediaPath('audio')))).status).toBe(404)
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/abc/media/video'))).status).toBe(404)
  })

  it('asks for a GitHub token first', async () => {
    const { app } = createTestApp()
    expect((await app.request(getRequest(mediaPath('video')))).status).toBe(412)
  })
})

describe('pull request recordings', () => {
  const artifactListPath = '/repos/cnotv/generative-art/actions/artifacts?name=pr-preview&per_page=100'
  const recordedScreenshot = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  const recordedVideo = new Uint8Array([26, 69, 223, 163, 4, 5, 6])
  const artifactList = {
    artifacts: [
      { id: 11, name: 'pr-preview', expired: false, created_at: '2026-09-01T00:00:00Z', workflow_run: { head_sha: 'fedc9876' } },
      { id: 12, name: 'pr-preview', expired: false, created_at: '2026-09-02T00:00:00Z', workflow_run: { head_sha: 'fedc9876' } },
      { id: 13, name: 'lighthouse-results', expired: false, created_at: '2026-09-02T00:00:00Z', workflow_run: { head_sha: 'fedc9876' } },
    ],
  }
  const recordingResponses = () => ({
    [artifactListPath]: Response.json(artifactList),
    '/repos/cnotv/generative-art/actions/artifacts/12/zip': new Response(
      zipSync({ 'screenshot.png': recordedScreenshot, 'video.webm': recordedVideo }),
    ),
  })

  it('marks a pull request with a recording as having both media', async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, recordingResponses())
    vault.saveSecret('github-token', sampleToken)
    const board: unknown = await (await app.request(getRequest('/api/repositories/cnotv/generative-art/board'))).json()
    expect(JSON.stringify(board)).toContain('"headSha":"fedc9876"')
    expect(board).toEqual(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({
            status: 'draft',
            cards: [expect.objectContaining({ pullRequest: expect.objectContaining({ media: { hasImage: true, hasVideo: true } }) })],
          }),
        ]),
      }),
    )
  })

  it('serves the newest recording of the head commit from this origin, downloading it once', async () => {
    const { app, vault, receivedRestRequests } = createTestApp({}, {}, { now: 0 }, recordingResponses())
    vault.saveSecret('github-token', sampleToken)
    const videoResponse = await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/video?sha=fedc9876'))
    expect(videoResponse.status).toBe(200)
    expect(videoResponse.headers.get('content-type')).toBe('video/webm')
    expect(videoResponse.headers.get('content-security-policy')).toContain('sandbox')
    expect(new Uint8Array(await videoResponse.arrayBuffer())).toEqual(recordedVideo)
    const imageResponse = await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/image?sha=fedc9876'))
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(recordedScreenshot)
    expect(receivedRestRequests.filter((request) => request.path.endsWith('/zip')).map((request) => request.path)).toEqual([
      '/repos/cnotv/generative-art/actions/artifacts/12/zip',
    ])
  })

  it('serves the base branch screenshot of a recording that has one', async () => {
    const recordedBefore = new Uint8Array([137, 80, 78, 71, 9, 9])
    const { app, vault } = createTestApp({}, {}, { now: 0 }, {
      ...recordingResponses(),
      '/repos/cnotv/generative-art/actions/artifacts/12/zip': new Response(
        zipSync({ 'screenshot.png': recordedScreenshot, 'video.webm': recordedVideo, 'before.png': recordedBefore }),
      ),
    })
    vault.saveSecret('github-token', sampleToken)
    const beforeResponse = await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/before?sha=fedc9876'))
    expect(beforeResponse.status).toBe(200)
    expect(beforeResponse.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await beforeResponse.arrayBuffer())).toEqual(recordedBefore)
  })

  it('answers 404 for the before picture of an older recording without downloading it again', async () => {
    const { app, vault, receivedRestRequests } = createTestApp({}, {}, { now: 0 }, recordingResponses())
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/before?sha=fedc9876'))).status).toBe(404)
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/before?sha=fedc9876'))).status).toBe(404)
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/31/media/image?sha=fedc9876'))).status).toBe(200)
    expect(receivedRestRequests.filter((request) => request.path.endsWith('/zip'))).toHaveLength(1)
  })

  it('never looks for a before picture in the body', async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, recordingResponses())
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/7/media/before?sha=0123abcd'))).status).toBe(404)
  })

  it('falls back to the body when the commit has no recording', async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, recordingResponses())
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(getRequest('/api/repositories/cnotv/generative-art/pulls/7/media/video?sha=0123abcd'))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(signedVideoUrl)
  })
})

describe('pull request draft', () => {
  const draftRequest = (draft: boolean) => jsonRequest('POST', '/api/repositories/cnotv/generative-art/pulls/7/draft', { draft })

  it('turns a ready pull request into a draft through its id', async () => {
    const github = createDraftGithub(false)
    const { app, vault } = createTestApp({ createGraphqlFetcher: github.createGraphqlFetcher })
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(draftRequest(true))).status).toBe(204)
    expect(github.receivedCalls.map((call) => call.variables)).toEqual([
      { owner: 'cnotv', name: 'generative-art', number: 7 },
      { pullRequestId: 'PR_kwDraft' },
    ])
    expect(github.receivedCalls[1]?.query).toContain('convertPullRequestToDraft')
  })

  it('marks a draft ready for review, and leaves one already in the asked state alone', async () => {
    const draftGithub = createDraftGithub(true)
    const draftApp = createTestApp({ createGraphqlFetcher: draftGithub.createGraphqlFetcher })
    draftApp.vault.saveSecret('github-token', sampleToken)
    expect((await draftApp.app.request(draftRequest(false))).status).toBe(204)
    expect(draftGithub.receivedCalls[1]?.query).toContain('markPullRequestReadyForReview')
    expect((await draftApp.app.request(draftRequest(true))).status).toBe(204)
    expect(draftGithub.receivedCalls).toHaveLength(3)
  })

  it('passes GitHub\'s refusal on with the access the App needs', async () => {
    const github = createDraftGithub(false, { errors: [{ message: 'Resource not accessible by integration' }] })
    const { app, vault } = createTestApp({ createGraphqlFetcher: github.createGraphqlFetcher })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(draftRequest(true))
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Resource not accessible by integration')
  })
})

describe('merge and close', () => {
  const pullPath = '/repos/cnotv/generative-art/pulls/7'
  const headSha = 'a'.repeat(40)
  const mergeRequest = (body: unknown = { title: 'feat: marbles (#6)', headSha }) =>
    jsonRequest('POST', '/api/repositories/cnotv/generative-art/pulls/7/merge', body)

  it('squash-merges pinned to the head commit, titled with the pull request number', async () => {
    const { app, vault, receivedRestRequests } = createTestApp({}, {}, { now: 0 }, { [`${pullPath}/merge`]: Response.json({ merged: true }) })
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(mergeRequest())).status).toBe(204)
    expect(receivedRestRequests).toContainEqual({
      path: `${pullPath}/merge`,
      method: 'PUT',
      body: { merge_method: 'squash', commit_title: 'feat: marbles (#6) (#7)', sha: headSha },
    })
  })

  it('closes a pull request without merging it', async () => {
    const { app, vault, receivedRestRequests } = createTestApp({}, {}, { now: 0 }, { [pullPath]: Response.json({ state: 'closed' }) })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(jsonRequest('POST', '/api/repositories/cnotv/generative-art/pulls/7/close', {}))
    expect(response.status).toBe(204)
    expect(receivedRestRequests).toContainEqual({ path: pullPath, method: 'PATCH', body: { state: 'closed' } })
  })

  it("passes on GitHub's reason when it refuses", async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, {
      [`${pullPath}/merge`]: Response.json({ message: 'Head branch was modified' }, { status: 409 }),
    })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(mergeRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Head branch was modified' })
  })

  it('says which permission is missing when GitHub forbids the write', async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, {
      [pullPath]: Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(jsonRequest('POST', '/api/repositories/cnotv/generative-art/pulls/7/close', {}))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: expect.stringContaining('write access to pull requests and contents') })
  })

  it('refuses a malformed head commit, and a repository that is not configured', async () => {
    const { app, vault } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(mergeRequest({ title: 'x', headSha: 'not-a-sha' }))).status).toBe(400)
    const otherRepository = jsonRequest('POST', '/api/repositories/someone/else/pulls/7/merge', { title: 'x', headSha })
    expect((await app.request(otherRepository)).status).toBe(404)
  })

  it('refuses a merge sent from another origin', async () => {
    const { app } = createTestApp()
    const crossOrigin = jsonRequest('POST', '/api/repositories/cnotv/generative-art/pulls/7/merge', { title: 'x', headSha }, {
      origin: 'https://attacker.example',
    })
    expect((await app.request(crossOrigin)).status).toBe(403)
  })
})

describe('new issues', () => {
  const issuesPath = '/repos/cnotv/generative-art/issues'
  const newIssueRequest = (body: unknown = { title: 'Marbles stick to the ramp', body: 'They stop halfway.' }) =>
    jsonRequest('POST', '/api/repositories/cnotv/generative-art/issues', body)

  it("opens the issue with the reader's token and answers its number and address", async () => {
    const { app, vault, receivedRestRequests } = createTestApp({}, {}, { now: 0 }, {
      [issuesPath]: Response.json({ number: 61, html_url: 'https://github.com/cnotv/generative-art/issues/61' }, { status: 201 }),
    })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(newIssueRequest())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ number: 61, url: 'https://github.com/cnotv/generative-art/issues/61' })
    expect(receivedRestRequests).toContainEqual({
      path: issuesPath,
      method: 'POST',
      body: { title: 'Marbles stick to the ramp', body: 'They stop halfway.' },
    })
  })

  it('says the App needs write access to issues when GitHub forbids it', async () => {
    const { app, vault } = createTestApp({}, {}, { now: 0 }, {
      [issuesPath]: Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(newIssueRequest())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: expect.stringContaining('write access to issues') })
  })

  it('refuses an empty title and a repository that is not configured', async () => {
    const { app, vault } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    expect((await app.request(newIssueRequest({ title: '  ', body: '' }))).status).toBe(400)
    expect((await app.request(jsonRequest('POST', '/api/repositories/someone/else/issues', { title: 'x' }))).status).toBe(404)
  })
})

describe('pull request files', () => {
  const filesPath = '/api/repositories/cnotv/generative-art/pulls/7/files'
  const githubFilesPath = '/repos/cnotv/generative-art/pulls/7/files?per_page=100&page=1'

  it("lists the pull request's files with the reader's token", async () => {
    const file = { filename: 'a.ts', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+x', blob_url: 'https://github.com/b' }
    const { app, vault, receivedTokens } = createTestApp({}, {}, { now: 0 }, { [githubFilesPath]: Response.json([file]) })
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(getRequest(filesPath))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      isTruncated: false,
      files: [{ filename: 'a.ts', previousFilename: null, status: 'added', additions: 1, deletions: 0, patch: file.patch, blobUrl: file.blob_url }],
    })
    expect(receivedTokens).toContain(sampleToken)
  })

  it("passes on GitHub's refusal, and refuses a repository that is not configured", async () => {
    const { app, vault } = createTestApp()
    vault.saveSecret('github-token', sampleToken)
    const refused = await app.request(getRequest(filesPath))
    expect(refused.status).toBe(502)
    expect((await app.request(getRequest('/api/repositories/someone/else/pulls/7/files'))).status).toBe(404)
  })
})

describe('netlify routes', () => {
  const netlifyPath = '/api/repositories/cnotv/generative-art/netlify'
  const netlifyToken = 'nfp_exampleNetlifyToken9876'
  const site = {
    name: 'cnotv-generative-art',
    ssl_url: 'https://cnotv-generative-art.netlify.app',
    url: 'http://cnotv-generative-art.netlify.app',
    admin_url: 'https://app.netlify.com/projects/cnotv-generative-art',
    build_settings: { provider: 'github', repo_path: 'cnotv/generative-art', installation_id: 55 },
  }

  it('asks for a token before reaching Netlify', async () => {
    const { app } = createTestApp()
    expect(await (await app.request(getRequest(netlifyPath))).json()).toEqual({ state: 'missing-token' })
    expect((await app.request(jsonRequest('POST', netlifyPath, {}))).status).toBe(412)
  })

  it('shows the site that builds the repository, without the token', async () => {
    const receivedTokens: string[] = []
    const { app, vault } = createTestApp({
      createNetlifyFetcher: (token) => async () => {
        receivedTokens.push(token)
        return Response.json([site])
      },
    })
    vault.saveSecret('netlify-token', netlifyToken)
    const responseText = await (await app.request(getRequest(netlifyPath))).text()
    expect(JSON.parse(responseText)).toEqual({
      state: 'active',
      siteName: site.name,
      siteUrl: site.ssl_url,
      adminUrl: site.admin_url,
    })
    expect(responseText).not.toContain(netlifyToken)
    expect(receivedTokens).toEqual([netlifyToken])
  })

  it('reports a repository no site builds as inactive', async () => {
    const { app, vault } = createTestApp({ createNetlifyFetcher: () => async () => Response.json([]) })
    vault.saveSecret('netlify-token', netlifyToken)
    expect(await (await app.request(getRequest(netlifyPath))).json()).toEqual({ state: 'inactive' })
  })

  it('passes on why a site could not be created', async () => {
    const { app, vault } = createTestApp({ createNetlifyFetcher: () => async () => Response.json([]) })
    vault.saveSecret('netlify-token', netlifyToken)
    vault.saveSecret('github-token', sampleToken)
    const response = await app.request(jsonRequest('POST', netlifyPath, {}))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: expect.stringContaining('Link one in Netlify once') })
  })
})
