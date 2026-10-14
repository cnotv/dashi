import type { z } from 'zod'
import type { RepositoryReference, WorkflowSkillsPullRequest, WorkflowSkillsState } from '@dashi/contracts'
import { githubErrorSchema } from '../github/schema.ts'
import type { GithubRestFetcher, GithubRestRequest } from '../github/types.ts'
import {
  blobSchema,
  gitCommitSchema,
  gitObjectSchema,
  gitReferenceSchema,
  openPullRequestsSchema,
  pluginDeclarationSchema,
  pullRequestLinkSchema,
  repositoryDetailsSchema,
  settingsObjectSchema,
  treeSchema,
} from './schema.ts'
import type {
  ClaudeSettings,
  GithubResult,
  TreeEntry,
  WorkflowSkillsComparison,
  WorkflowSkillsPullRequestResult,
  WorkflowSkillsStatusResult,
} from './types.ts'

const agentBasePath = '/repos/cnotv/agent-base'
const agentBaseBranch = 'main'
const sourceSkillsSegments = ['plugins', 'workflow', 'skills']
const claudeSegments = ['.claude']
const settingsPath = 'settings.json'
const skillsPrefix = 'skills/'
const pluginName = 'workflow@cnotv'
const agentBaseMarketplace = { source: { source: 'github', repo: 'cnotv/agent-base' } }
// Dashi alone writes this branch, so it is reset to each new fix rather than stacked on. It is
// not the branch the older copying pull requests used, so one of those left open is not taken
// for this fix.
export const workflowSkillsBranch = 'chore/workflow-plugin'
const commitMessage = "chore: take agent-base's workflow skills from its plugin"
const pullRequestTitle = "chore: take agent-base's workflow skills from its plugin"
const pullRequestBody = `Declares [agent-base's workflow plugin](https://github.com/cnotv/agent-base/tree/main/plugins/workflow) in \`.claude/settings.json\` and removes the copies of its skills from \`.claude/skills/\`.

Every Claude Code session, local or cloud, installs the plugins \`.claude/settings.json\` enables, so the skills arrive as \`/workflow:<name>\` and stay current with agent-base. A copy under \`.claude/skills/\` would load a second time under its bare name and drift from the plugin. Skills this repository wrote itself stay where they are.

Opened from Dashi's board.`

const failureOf = (status: number, message: string): { ok: false; status: number; message: string } => ({ ok: false, status, message })

const readGithub = async <Schema extends z.ZodType>(
  fetchGithub: GithubRestFetcher,
  path: string,
  schema: Schema,
  request?: GithubRestRequest,
): Promise<GithubResult<z.infer<Schema>>> => {
  const response = await fetchGithub(path, request)
  const responseBody: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsedError = githubErrorSchema.safeParse(responseBody)
    return failureOf(response.status, parsedError.success ? parsedError.data.message : `GitHub answered ${response.status}`)
  }
  const parsedBody = schema.safeParse(responseBody)
  return parsedBody.success ? { ok: true, value: parsedBody.data } : failureOf(502, `Unexpected answer from GitHub for ${path}`)
}

// Walks down one directory at a time, so a large repository's recursive tree, which GitHub
// truncates, is never read whole; a directory that is missing has no files.
const readFilesUnder = async (
  fetchGithub: GithubRestFetcher,
  repositoryPath: string,
  treeSha: string,
  remainingSegments: string[],
): Promise<GithubResult<TreeEntry[]>> => {
  const [nextSegment, ...laterSegments] = remainingSegments
  if (nextSegment === undefined) {
    const subtree = await readGithub(fetchGithub, `${repositoryPath}/git/trees/${treeSha}?recursive=1`, treeSchema)
    return subtree.ok ? { ok: true, value: subtree.value.tree.filter((entry) => entry.type === 'blob') } : subtree
  }
  const tree = await readGithub(fetchGithub, `${repositoryPath}/git/trees/${treeSha}`, treeSchema)
  if (!tree.ok) return tree
  const child = tree.value.tree.find((entry) => entry.type === 'tree' && entry.path === nextSegment)
  return child === undefined ? { ok: true, value: [] } : readFilesUnder(fetchGithub, repositoryPath, child.sha, laterSegments)
}

/**
 * Picks the files under .claude/ that copy a skill the plugin ships, so they would load twice.
 * A skill folder whose name the plugin does not use is the repository's own and is left out.
 * @param pluginSkillNames The names of the skills agent-base's workflow plugin ships.
 * @param claudeEntries The repository's files under .claude/, by path inside it.
 * @returns The copies, by the same paths.
 */
export const pluginSkillCopies = (pluginSkillNames: string[], claudeEntries: TreeEntry[]): TreeEntry[] =>
  claudeEntries.filter((entry) => pluginSkillNames.some((skillName) => entry.path.startsWith(`${skillsPrefix}${skillName}/`)))

/**
 * Adds the cnotv marketplace and enables the workflow plugin, keeping every other setting and
 * every other marketplace or plugin as it was.
 * @param settings The repository's .claude/settings.json, or an empty object when it has none.
 * @returns The settings with the plugin declared.
 */
export const withPluginDeclared = (settings: ClaudeSettings): ClaudeSettings => {
  const recordOf = (value: unknown): ClaudeSettings => settingsObjectSchema.safeParse(value).data ?? {}
  return {
    ...settings,
    extraKnownMarketplaces: { ...recordOf(settings.extraKnownMarketplaces), cnotv: agentBaseMarketplace },
    enabledPlugins: { ...recordOf(settings.enabledPlugins), [pluginName]: true },
  }
}

const parseSettings = (text: string): ClaudeSettings | null => {
  try {
    return settingsObjectSchema.safeParse(JSON.parse(text)).data ?? null
  } catch {
    return null
  }
}

const readSettings = async (
  fetchGithub: GithubRestFetcher,
  repositoryPath: string,
  claudeEntries: TreeEntry[],
): Promise<GithubResult<ClaudeSettings | null>> => {
  const settingsEntry = claudeEntries.find((entry) => entry.path === settingsPath)
  if (settingsEntry === undefined) return { ok: true, value: {} }
  const settingsBlob = await readGithub(fetchGithub, `${repositoryPath}/git/blobs/${settingsEntry.sha}`, blobSchema)
  if (!settingsBlob.ok) return settingsBlob
  return { ok: true, value: parseSettings(Buffer.from(settingsBlob.value.content, 'base64').toString('utf8')) }
}

const stateOf = (isDeclared: boolean, copyCount: number): WorkflowSkillsState =>
  !isDeclared ? 'undeclared' : copyCount > 0 ? 'copied' : 'current'

/**
 * Checks a repository's .claude/settings.json for agent-base's workflow plugin and its
 * .claude/skills/ for copies of the plugin's skills, and finds the pull request Dashi opened to
 * fix either, if one is still open.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @returns The comparison, or GitHub's reason for failing.
 */
export const compareWorkflowSkills = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
): Promise<GithubResult<WorkflowSkillsComparison>> => {
  const repositoryPath = `/repos/${repository.owner}/${repository.name}`
  const sourceEntries = await readFilesUnder(fetchGithub, agentBasePath, agentBaseBranch, sourceSkillsSegments)
  if (!sourceEntries.ok) return sourceEntries
  const pluginSkillNames = [...new Set(sourceEntries.value.map((entry) => entry.path.split('/')[0] ?? ''))].filter((name) => name !== '')
  if (pluginSkillNames.length === 0) return failureOf(502, `agent-base has no skills under ${sourceSkillsSegments.join('/')}`)
  const details = await readGithub(fetchGithub, repositoryPath, repositoryDetailsSchema)
  if (!details.ok) return details
  const defaultBranch = details.value.default_branch
  const reference = await readGithub(fetchGithub, `${repositoryPath}/git/ref/heads/${defaultBranch}`, gitReferenceSchema)
  if (!reference.ok) return reference
  const baseCommit = await readGithub(fetchGithub, `${repositoryPath}/git/commits/${reference.value.object.sha}`, gitCommitSchema)
  if (!baseCommit.ok) return baseCommit
  const claudeEntries = await readFilesUnder(fetchGithub, repositoryPath, baseCommit.value.tree.sha, claudeSegments)
  if (!claudeEntries.ok) return claudeEntries
  const settings = await readSettings(fetchGithub, repositoryPath, claudeEntries.value)
  if (!settings.ok) return settings
  const copiedEntries = pluginSkillCopies(pluginSkillNames, claudeEntries.value)
  const state = stateOf(pluginDeclarationSchema.safeParse(settings.value).success, copiedEntries.length)
  const comparisonBase = {
    settings: settings.value,
    copiedEntries,
    defaultBranch,
    baseCommitSha: baseCommit.value.sha,
    baseTreeSha: baseCommit.value.tree.sha,
  }
  if (state === 'current') {
    return { ok: true, value: { ...comparisonBase, openPullRequest: null, status: { state, copiedFileCount: 0, pullRequestUrl: null } } }
  }
  const openPullRequests = await readGithub(
    fetchGithub,
    `${repositoryPath}/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${workflowSkillsBranch}`)}`,
    openPullRequestsSchema,
  )
  if (!openPullRequests.ok) return openPullRequests
  const openPullRequest = openPullRequests.value[0] ?? null
  return {
    ok: true,
    value: {
      ...comparisonBase,
      openPullRequest: openPullRequest === null ? null : { number: openPullRequest.number, url: openPullRequest.html_url },
      status: {
        state: openPullRequest !== null ? 'pull-request-open' : state,
        copiedFileCount: copiedEntries.length,
        pullRequestUrl: openPullRequest?.html_url ?? null,
      },
    },
  }
}

/**
 * Says whether a repository takes agent-base's workflow skills from the plugin alone, lacks the
 * plugin's declaration, or keeps copies of its skills.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @returns The status, or GitHub's reason for failing.
 */
export const readWorkflowSkillsStatus = async (fetchGithub: GithubRestFetcher, repository: RepositoryReference): Promise<WorkflowSkillsStatusResult> => {
  const comparison = await compareWorkflowSkills(fetchGithub, repository)
  return comparison.ok ? { ok: true, value: comparison.value.status } : comparison
}

// A path with no sha removes that file from the tree; a path with content writes it.
const fixedTreeEntries = (settings: ClaudeSettings, copiedEntries: TreeEntry[]): Array<Record<string, unknown>> => [
  { path: `${claudeSegments.join('/')}/${settingsPath}`, mode: '100644', type: 'blob', content: `${JSON.stringify(withPluginDeclared(settings), null, 2)}\n` },
  ...copiedEntries.map((entry) => ({ path: `${claudeSegments.join('/')}/${entry.path}`, mode: entry.mode, type: 'blob', sha: null })),
]

const pointBranchAt = async (fetchGithub: GithubRestFetcher, repositoryPath: string, commitSha: string): Promise<GithubResult<unknown>> => {
  const created = await readGithub(fetchGithub, `${repositoryPath}/git/refs`, gitReferenceSchema, {
    method: 'POST',
    body: { ref: `refs/heads/${workflowSkillsBranch}`, sha: commitSha },
  })
  // 422 is GitHub's answer for a branch left from an earlier copy.
  if (created.ok || created.status !== 422) return created
  return readGithub(fetchGithub, `${repositoryPath}/git/refs/heads/${workflowSkillsBranch}`, gitReferenceSchema, {
    method: 'PATCH',
    body: { sha: commitSha, force: true },
  })
}

/**
 * Opens a pull request that declares agent-base's workflow plugin in .claude/settings.json and
 * deletes the copies of its skills from .claude/skills/; the repository's own skills stay.
 * @param fetchGithub The REST caller, holding the reader's token, which needs write access to contents and pull requests.
 * @param repository The repository.
 * @returns The pull request, the one already open if there is one, or GitHub's reason for failing.
 */
export const openWorkflowSkillsPullRequest = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
): Promise<WorkflowSkillsPullRequestResult> => {
  const repositoryPath = `/repos/${repository.owner}/${repository.name}`
  const comparison = await compareWorkflowSkills(fetchGithub, repository)
  if (!comparison.ok) return comparison
  const { status, openPullRequest, settings, copiedEntries, defaultBranch, baseCommitSha, baseTreeSha } = comparison.value
  if (openPullRequest !== null) return { ok: true, value: openPullRequest }
  if (status.state === 'current') return failureOf(409, 'The workflow skills already come from the plugin alone')
  if (settings === null) return failureOf(409, '.claude/settings.json is not a JSON object, so Dashi cannot add the plugin to it')
  const tree = await readGithub(fetchGithub, `${repositoryPath}/git/trees`, gitObjectSchema, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: fixedTreeEntries(settings, copiedEntries) },
  })
  if (!tree.ok) return tree
  const commit = await readGithub(fetchGithub, `${repositoryPath}/git/commits`, gitObjectSchema, {
    method: 'POST',
    body: { message: commitMessage, tree: tree.value.sha, parents: [baseCommitSha] },
  })
  if (!commit.ok) return commit
  const branch = await pointBranchAt(fetchGithub, repositoryPath, commit.value.sha)
  if (!branch.ok) return branch
  const pullRequest = await readGithub(fetchGithub, `${repositoryPath}/pulls`, pullRequestLinkSchema, {
    method: 'POST',
    body: { title: pullRequestTitle, head: workflowSkillsBranch, base: defaultBranch, body: pullRequestBody },
  })
  return pullRequest.ok ? { ok: true, value: { number: pullRequest.value.number, url: pullRequest.value.html_url } satisfies WorkflowSkillsPullRequest } : pullRequest
}
