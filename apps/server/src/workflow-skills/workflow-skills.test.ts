import { describe, expect, it } from 'vitest'
import { createTestApp, getRequest, jsonRequest } from '../app/test-app.ts'
import type { ReceivedRestRequest } from '../app/types.ts'
import type { GithubRestFetcher } from '../github/types.ts'
import type { TreeEntry } from './types.ts'
import { openWorkflowSkillsPullRequest, pluginSkillCopies, readWorkflowSkillsStatus, withPluginDeclared, workflowSkillsBranch } from './workflow-skills.ts'

const repository = { owner: 'cnotv', name: 'generative-art' }
const targetPath = '/repos/cnotv/generative-art'
const sourcePath = '/repos/cnotv/agent-base'

const blob = (path: string, sha: string): TreeEntry => ({ path, mode: '100644', type: 'blob', sha })
const directory = (path: string, sha: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha })
const sourceSkills = [blob('start/SKILL.md', 'sha-start'), blob('open-pr/SKILL.md', 'sha-open-pr')]
const declaredSettings = {
  permissions: { allow: ['Bash(pnpm:*)'] },
  extraKnownMarketplaces: { cnotv: { source: { source: 'github', repo: 'cnotv/agent-base' } } },
  enabledPlugins: { 'workflow@cnotv': true },
}
const ownSkill = blob('skills/perf-check/SKILL.md', 'sha-perf-check')
const copiedSkill = blob('skills/start/SKILL.md', 'sha-start')
const statusPullRequestsPath = `GET ${targetPath}/pulls?state=open&head=${encodeURIComponent(`cnotv:${workflowSkillsBranch}`)}`

type Answers = Record<string, [number, unknown]>

const base64Of = (text: string): string => Buffer.from(text).toString('base64')

// agent-base's skills, and a repository on main whose .claude/ holds the given settings (text, or
// null for no file) and files.
const githubAnswers = (settingsText: string | null, claudeFiles: TreeEntry[] = []): Answers => {
  const claudeEntries = [...(settingsText === null ? [] : [blob('settings.json', 'sha-settings')]), ...claudeFiles]
  return {
    [`GET ${sourcePath}/git/trees/main`]: [200, { sha: 'source-root', tree: [directory('plugins', 'source-plugins')] }],
    [`GET ${sourcePath}/git/trees/source-plugins`]: [200, { sha: 'source-plugins', tree: [directory('workflow', 'source-workflow')] }],
    [`GET ${sourcePath}/git/trees/source-workflow`]: [200, { sha: 'source-workflow', tree: [directory('skills', 'source-skills')] }],
    [`GET ${sourcePath}/git/trees/source-skills?recursive=1`]: [200, { sha: 'source-skills', tree: [directory('start', 'tree-start'), ...sourceSkills] }],
    [`GET ${targetPath}`]: [200, { default_branch: 'main' }],
    [`GET ${targetPath}/git/ref/heads/main`]: [200, { object: { sha: 'base-commit' } }],
    [`GET ${targetPath}/git/commits/base-commit`]: [200, { sha: 'base-commit', tree: { sha: 'base-tree' } }],
    [`GET ${targetPath}/git/trees/base-tree`]: [200, { sha: 'base-tree', tree: claudeEntries.length === 0 ? [] : [directory('.claude', 'target-claude')] }],
    [`GET ${targetPath}/git/trees/target-claude?recursive=1`]: [200, { sha: 'target-claude', tree: claudeEntries }],
    [`GET ${targetPath}/git/blobs/sha-settings`]: [200, { content: `${base64Of(settingsText ?? '')}\n`, encoding: 'base64' }],
    [statusPullRequestsPath]: [200, []],
    [`POST ${targetPath}/git/trees`]: [201, { sha: 'new-tree' }],
    [`POST ${targetPath}/git/commits`]: [201, { sha: 'new-commit' }],
    [`POST ${targetPath}/git/refs`]: [201, { object: { sha: 'new-commit' } }],
    [`POST ${targetPath}/pulls`]: [201, { number: 12, html_url: 'https://github.com/cnotv/generative-art/pull/12' }],
  }
}

const declared = JSON.stringify(declaredSettings)

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

describe('pluginSkillCopies', () => {
  it("keeps the files of skills the plugin ships, and leaves the repository's own skills and settings out", () => {
    const claudeEntries = [blob('settings.json', 'sha-settings'), ownSkill, copiedSkill, blob('skills/start/notes.md', 'sha-notes'), blob('skills/starter/SKILL.md', 'sha-starter')]
    expect(pluginSkillCopies(['start', 'open-pr'], claudeEntries)).toEqual([copiedSkill, blob('skills/start/notes.md', 'sha-notes')])
  })
})

describe('withPluginDeclared', () => {
  it('adds the marketplace and the plugin next to the settings already there', () => {
    const settings = { attribution: { commit: '' }, extraKnownMarketplaces: { other: { source: 'x' } }, enabledPlugins: { 'other@x': false } }
    expect(withPluginDeclared(settings)).toEqual({
      attribution: { commit: '' },
      extraKnownMarketplaces: { other: { source: 'x' }, cnotv: { source: { source: 'github', repo: 'cnotv/agent-base' } } },
      enabledPlugins: { 'other@x': false, 'workflow@cnotv': true },
    })
  })
})

describe('readWorkflowSkillsStatus', () => {
  it('says the plugin is undeclared when the repository has no .claude directory', async () => {
    const { fetchGithub } = createFakeGithub(githubAnswers(null))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({ ok: true, value: { state: 'undeclared', copiedFileCount: 0, pullRequestUrl: null } })
  })

  it('says the plugin is undeclared when the settings enable something else, or are not JSON', async () => {
    const otherPlugin = JSON.stringify({ enabledPlugins: { 'workflow@cnotv': false } })
    expect(await readWorkflowSkillsStatus(createFakeGithub(githubAnswers(otherPlugin, [copiedSkill])).fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'undeclared', copiedFileCount: 1, pullRequestUrl: null },
    })
    expect(await readWorkflowSkillsStatus(createFakeGithub(githubAnswers('{ not json')).fetchGithub, repository)).toMatchObject({ value: { state: 'undeclared' } })
  })

  it("says the skills are copied when the plugin is declared but .claude/skills/ also holds its skills", async () => {
    const { fetchGithub } = createFakeGithub(githubAnswers(declared, [ownSkill, copiedSkill]))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({ ok: true, value: { state: 'copied', copiedFileCount: 1, pullRequestUrl: null } })
  })

  it("says the skills are current with the plugin declared and only the repository's own skills, without asking for pull requests", async () => {
    const { fetchGithub, requests } = createFakeGithub(githubAnswers(declared, [ownSkill]))
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({ ok: true, value: { state: 'current', copiedFileCount: 0, pullRequestUrl: null } })
    expect(requests.some((request) => request.path.includes('/pulls'))).toBe(false)
  })

  it('points at the pull request already open for the fix', async () => {
    const openPullRequest = { number: 9, html_url: 'https://github.com/cnotv/generative-art/pull/9' }
    const { fetchGithub } = createFakeGithub({ ...githubAnswers(null), [statusPullRequestsPath]: [200, [openPullRequest]] })
    expect(await readWorkflowSkillsStatus(fetchGithub, repository)).toEqual({
      ok: true,
      value: { state: 'pull-request-open', copiedFileCount: 0, pullRequestUrl: openPullRequest.html_url },
    })
  })

  it("passes on GitHub's refusal", async () => {
    const answers = { ...githubAnswers(null), [`GET ${targetPath}`]: [404, { message: 'Not Found' }] satisfies [number, unknown] }
    expect(await readWorkflowSkillsStatus(createFakeGithub(answers).fetchGithub, repository)).toEqual({ ok: false, status: 404, message: 'Not Found' })
  })
})

describe('openWorkflowSkillsPullRequest', () => {
  it('declares the plugin, deletes the copies and keeps the own skills, on its branch, and opens the pull request', async () => {
    const settings = { permissions: { allow: ['Bash(pnpm:*)'] } }
    const { fetchGithub, requests } = createFakeGithub(githubAnswers(JSON.stringify(settings), [ownSkill, copiedSkill]))
    expect(await openWorkflowSkillsPullRequest(fetchGithub, repository)).toEqual({
      ok: true,
      value: { number: 12, url: 'https://github.com/cnotv/generative-art/pull/12' },
    })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/trees`)).toEqual({
      base_tree: 'base-tree',
      tree: [
        { path: '.claude/settings.json', mode: '100644', type: 'blob', content: `${JSON.stringify(withPluginDeclared(settings), null, 2)}\n` },
        { path: '.claude/skills/start/SKILL.md', mode: '100644', type: 'blob', sha: null },
      ],
    })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/commits`)).toMatchObject({ tree: 'new-tree', parents: ['base-commit'] })
    expect(bodyOf(requests, 'POST', `${targetPath}/git/refs`)).toEqual({ ref: `refs/heads/${workflowSkillsBranch}`, sha: 'new-commit' })
    expect(bodyOf(requests, 'POST', `${targetPath}/pulls`)).toMatchObject({ head: workflowSkillsBranch, base: 'main' })
  })

  it('writes a settings file when the repository has none', async () => {
    const { fetchGithub, requests } = createFakeGithub(githubAnswers(null))
    expect((await openWorkflowSkillsPullRequest(fetchGithub, repository)).ok).toBe(true)
    expect(bodyOf(requests, 'POST', `${targetPath}/git/trees`)).toEqual({
      base_tree: 'base-tree',
      tree: [{ path: '.claude/settings.json', mode: '100644', type: 'blob', content: `${JSON.stringify(withPluginDeclared({}), null, 2)}\n` }],
    })
  })

  it('moves the branch left by an earlier fix onto the new commit', async () => {
    const { fetchGithub, requests } = createFakeGithub({
      ...githubAnswers(null),
      [`POST ${targetPath}/git/refs`]: [422, { message: 'Reference already exists' }],
      [`PATCH ${targetPath}/git/refs/heads/${workflowSkillsBranch}`]: [200, { object: { sha: 'new-commit' } }],
    })
    expect((await openWorkflowSkillsPullRequest(fetchGithub, repository)).ok).toBe(true)
    expect(bodyOf(requests, 'PATCH', `${targetPath}/git/refs/heads/${workflowSkillsBranch}`)).toEqual({ sha: 'new-commit', force: true })
  })

  it('hands back the pull request already open, and refuses when current or when the settings are not JSON', async () => {
    const openPullRequest = { number: 9, html_url: 'https://github.com/cnotv/generative-art/pull/9' }
    const withOpenPullRequest = createFakeGithub({ ...githubAnswers(null), [statusPullRequestsPath]: [200, [openPullRequest]] })
    expect(await openWorkflowSkillsPullRequest(withOpenPullRequest.fetchGithub, repository)).toEqual({ ok: true, value: { number: 9, url: openPullRequest.html_url } })
    expect(withOpenPullRequest.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(await openWorkflowSkillsPullRequest(createFakeGithub(githubAnswers(declared, [ownSkill])).fetchGithub, repository)).toMatchObject({ ok: false, status: 409 })
    const unreadable = createFakeGithub(githubAnswers('{ not json'))
    expect(await openWorkflowSkillsPullRequest(unreadable.fetchGithub, repository)).toMatchObject({ ok: false, status: 409 })
    expect(unreadable.requests.some((request) => request.method === 'POST')).toBe(false)
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
    expect(await (await app.request(getRequest(statusPath))).json()).toEqual({ state: 'undeclared', copiedFileCount: 0, pullRequestUrl: null })
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

  it('names the access the token lacks when GitHub refuses the fix, and refuses unknown repositories', async () => {
    const { app } = appWith({ ...githubAnswers(null), [`POST ${targetPath}/git/trees`]: [403, { message: 'Resource not accessible by integration' }] })
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
