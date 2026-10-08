import { describe, expect, it } from 'vitest'
import { createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'
import type { ReceivedRestRequest } from '../app/types.ts'
import type { GithubRestFetcher } from '../github/types.ts'
import type { TreeEntry } from './types.ts'
import { changedSkillEntries, openWorkflowSkillsPullRequest, readWorkflowSkillsStatus, workflowSkillsBranch } from './workflow-skills.ts'

const repository = { owner: 'cnotv', name: 'generative-art' }
const targetPath = '/repos/cnotv/generative-art'
const sourcePath = '/repos/cnotv/agent-base'

const blob = (path: string, sha: string): TreeEntry => ({ path, mode: '100644', type: 'blob', sha })
const directory = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const sourceSkills = [blob('start/SKILL.md', 'sha-start'), blob('open-pr/SKILL.md', 'sha-open-pr')]

type Answers = Record<string, [number, unknown]>

// agent-base's skills, and a repository on main whose .claude/skills/ holds the given files.
const githubAnswers = (targetSkills: TreeEntry[] | null): Answers => ({
  [`GET ${sourcePath}/git/trees/main`]: [200, { sha: 'source-root', tree: [directory('plugins', 'source-plugins')] }],
  [`GET ${sourcePath}/git/trees/source-plugins`]: [200, { sha: 'source-plugins', tree: [directory('workflow', 'source-workflow')] }],
  [`GET ${sourcePath}/git/trees/source-workflow`]: [200, { sha: 'source-workflow', tree: [directory('skills', 'source-skills')] }],
  [`GET ${sourcePath}/git/trees/source-skills?recursive=1`]: [200, { sha: 'source-skills', tree: [directory('start', 'tree-start'), ...sourceSkills] }],
  [`GET ${sourcePath}/git/blobs/sha-start`]: [200, { content: 'c3RhcnQ=\n', encoding: 'base64' }],
  [`GET ${sourcePath}/git/blobs/sha-open-pr`]: [200, { content: 'b3Blbi1wcg==\n', encoding: 'base64' }],
  [`GET ${targetPath}`]: [200, { default_branch: 'main' }],
  [`GET ${targetPath}/git/ref/heads/main`]: [200, { object: { sha: 'base-commit' } }],
  [`GET ${targetPath}/git/commits/base-commit`]: [200, { sha: 'base-commit', tree: { sha: 'base-tree' } }],
  [`GET ${targetPath}/git/trees/base-tree`]: [200, { sha: 'base-tree', tree: targetSkills === null ? [] : [directory('.claude', 'target-claude')] }],
  [`GET ${targetPath}/git/trees/target-claude`]: [200, { sha: 'target-claude', tree: [directory('skills', 'target-skills')] }],
  [`GET ${targetPath}/git/trees/target-skills?recursive=1`]: [200, { sha: 'target-skills', tree: targetSkills ?? [] }],
  [`GET ${targetPath}/pulls?state=open&head=${encodeURIComponent(`cnotv:${workflowSkillsBranch}`)}`]: [200, []],
  [`POST ${targetPath}/git/blobs`]: [201, { sha: 'copied-blob' }],
  [`POST ${targetPath}/git/trees`]: [201, { sha: 'new-tree' }],
  [`POST ${targetPath}/git/commits`]: [201, { sha: 'new-commit' }],
  [`POST ${targetPath}/git/refs`]: [201, { object: { sha: 'new-commit' } }],
  [`POST ${targetPath}/pulls`]: [201, { number: 12, html_url: 'https://github.com/cnotv/generative-art/pull/12' }],
})

const createFakeGithub = (answers: Answers) => {
  const requests: ReceivedRestRequest[] = []
  const fetchGithub: GithubRestFetcher = async (path, request = { method: 'GET' }) => {
    requests.push({ path, ...request })
    const [status, body] = answers[`${request.method} ${path}`] ?? [404, { message: 'Not Found' }]
    return new Response(JSON.stringify(body), { status })
  }
  return { fetchGithub, requests }
}

const bodyOf = (requests: ReceivedRestRequest[], method: string, path: string): unknown =>
  requests.find((request) => request.method === method && request.path === path)?.body

describe('changedSkillEntries', () => {
  it('keeps the files the repository lacks or holds with other content', () => {
    expect(changedSkillEntries(sourceSkills, [blob('start/SKILL.md', 'sha-start'), blob('start/notes.md', 'sha-notes')])).toEqual([
      blob('open-pr/SKILL.md', 'sha-open-pr'),
    ])
    expect(changedSkillEntries(sourceSkills, [blob('start/SKILL.md', 'older')])).toEqual(sourceSkills)
  })
})

describe('readWorkflowSkillsStatus', () => {
  it('says the skills are missing when the repository has no .claude directory', async () => {
    const { fetchGithub } = createFakeGithub(githubAnswers(null))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'missing', changedFileCount: 2, pullRequestUrl: null },
    })
  })

  it('says an older copy is outdated, and counts only the files that differ', async () => {
    const { fetchGithub } = createFakeGithub(githubAnswers([blob('start/SKILL.md', 'older'), blob('open-pr/SKILL.md', 'sha-open-pr')]))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'outdated', changedFileCount: 1, pullRequestUrl: null },
    })
  })

  it('says the skills are current without asking for pull requests', async () => {
    const { fetchGithub, requests } = createFakeGithub(githubAnswers(sourceSkills))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'current', changedFileCount: 0, pullRequestUrl: null },
    })
    expect(requests.some((request) => request.path.includes('/pulls'))).toBe(false)
  })

  it('points at the pull request already open for the copy', async () => {
    const answers = githubAnswers(null)
    const openPullRequest = { number: 9, html_url: 'https://github.com/cnotv/generative-art/pull/9' }
    const { fetchGithub } = createFakeGithub({
      ...answers,
      [`GET ${targetPath}/pulls?state=open&head=${encodeURIComponent(`cnotv:${workflowSkillsBranch}`)}`]: [200, [openPullRequest]],
    })
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'pull-request-open', changedFileCount: 2, pullRequestUrl: openPullRequest.html_url },
    })
  })

  it("passes on GitHub's refusal", async () => {
    const answers = { ...githubAnswers(null), [`GET ${targetPath}`]: [404, { message: 'Not Found' }] satisfies [number, unknown] }
    expect(await readWorkflowSkillsStatus(createFakeGithub(answers).fetchGithub, repository)).toEqual({ ok: false, status: 404, message: 'Not Found' })
  })
})

describe('openWorkflowSkillsPullRequest', () => {
  it('commits a copy of every changed skill file under .claude/skills/ on its branch and opens the pull request', async () => {
    const { fetchGithub, requests } = createFakeGithub(githubAnswers([blob('open-pr/SKILL.md', 'sha-open-pr')]))
    expect(await openWorkflowSkillsPullRequest(fetchGithub, repository)).toEqual({
      ok: true,
      value: { number: 12, url: 'https://github.com/cnotv/generative-art/pull/12' },
    })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/blobs`)).toEqual({ content: 'c3RhcnQ=', encoding: 'base64' })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/trees`)).toEqual({
      base_tree: 'base-tree',
      tree: [{ path: '.claude/skills/start/SKILL.md', mode: '100644', type: 'blob', sha: 'copied-blob' }],
    })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/commits`)).toMatchObject({ tree: 'new-tree', parents: ['base-commit'] })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/refs`)).toEqual({ ref: `refs/heads/${workflowSkillsBranch}`, sha: 'new-commit' })
    expect(bodyOf(requests, 'POST', `${targetPath}/pulls`)).toMatchObject({ head: workflowSkillsBranch, base: 'main' })
  })

  it('moves the branch left by an earlier copy onto the new commit', async () => {
    const { fetchGithub, requests } = createFakeGithub({
      ...githubAnswers(null),
      [`POST ${targetPath}/git/refs`]: [422, { message: 'Reference already exists' }],
      [`PATCH ${targetPath}/git/refs/heads/${workflowSkillsBranch}`]: [200, { object: { sha: 'new-commit' } }],
    })
    expect((await openWorkflowSkillsPullRequest(fetchGithub, repository)).ok).toBe(true)
    expect(bodyOf(requests, 'PATCH', `${targetPath}/git/refs/heads/${workflowSkillsBranch}`)).toEqual({ sha: 'new-commit', force: true })
  })

  it('hands back the pull request already open, and refuses when the skills are current', async () => {
    const openPullRequest = { number: 9, html_url: 'https://github.com/cnotv/generative-art/pull/9' }
    const withOpenPullRequest = createFakeGithub({
      ...githubAnswers(null),
      [`GET ${targetPath}/pulls?state=open&head=${encodeURIComponent(`cnotv:${workflowSkillsBranch}`)}`]: [200, [openPullRequest]],
    })
    expect(await openWorkflowSkillsPullRequest(withOpenPullRequest.fetchGithub, repository)).toEqual({ ok: true, value: { number: 9, url: openPullRequest.html_url } })
    expect(withOpenPullRequest.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(await openWorkflowSkillsPullRequest(createFakeGithub(githubAnswers(sourceSkills)).fetchGithub, repository)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('workflow skills routes', () => {
  const appWith = (answers: Answers) => {
    const fakeGithub = createFakeGithub(answers)
    const testApp = createTestApp({ createGithubRestFetcher: () => fakeGithub.fetchGithub })
    testApp.vault.saveSecret('github-token', 'ghp_storedToken000000000000000000000000001')
    return { ...testApp, githubRequests: fakeGithub.requests }
  }

  it('answers the status, then the cached one, and a fresh one after opening the pull request', async () => {
    const { app, githubRequests } = appWith(githubAnswers(null))
    const statusPath = '/api/repositories/cnotv/generative-art/workflow-skills'
    expect(await (await app.request(getRequest(statusPath))).json()).toEqual({ state: 'missing', changedFileCount: 2, pullRequestUrl: null })
    const requestsAfterFirstRead = githubRequests.length
    await app.request(getRequest(statusPath))
    expect(githubRequests).toHaveLength(requestsAfterFirstRead)

    const opened = await app.request(jsonRequest('POST', statusPath, {}))
    expect(opened.status).toBe(201)
    expect(await opened.json()).toEqual({ number: 12, url: 'https://github.com/cnotv/generative-art/pull/12' })
    const requestsAfterOpening = githubRequests.length
    await app.request(getRequest(statusPath))
    expect(githubRequests.length).toBeGreaterThan(requestsAfterOpening)
  })

  it('names the access the token lacks when GitHub refuses the copy, and refuses unknown repositories', async () => {
    const { app } = appWith({ ...githubAnswers(null), [`POST ${targetPath}/git/blobs`]: [403, { message: 'Resource not accessible by integration' }] })
    const refused = await app.request(jsonRequest('POST', '/api/repositories/cnotv/generative-art/workflow-skills', {}))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({
      error: 'Resource not accessible by integration. The GitHub App or stored token needs write access to contents and pull requests.',
    })
    expect((await app.request(getRequest('/api/repositories/cnotv/unknown/workflow-skills'))).status).toBe(404)
  })

  it('asks for a GitHub token first', async () => {
    const { app } = createTestApp()
    expect((await app.request(getRequest('/api/repositories/cnotv/generative-art/workflow-skills'))).status).toBe(412)
  })
})
