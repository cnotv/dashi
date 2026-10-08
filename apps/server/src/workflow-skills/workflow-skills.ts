import type { z } from 'zod'
import type { RepositoryReference, WorkflowSkillsPullRequest } from '@dashi/contracts'
import { githubErrorSchema } from '../github/schema.ts'
import type { GithubRestFetcher, GithubRestRequest } from '../github/types.ts'
import {
  blobSchema,
  gitCommitSchema,
  gitObjectSchema,
  gitReferenceSchema,
  openPullRequestsSchema,
  pullRequestLinkSchema,
  repositoryDetailsSchema,
  treeSchema,
} from './schema.ts'
import type { GithubResult, TreeEntry, WorkflowSkillsComparison, WorkflowSkillsPullRequestResult, WorkflowSkillsStatusResult } from './types.ts'

const agentBasePath = '/repos/cnotv/agent-base'
const agentBaseBranch = 'main'
const sourceSkillsSegments = ['plugins', 'workflow', 'skills']
const targetSkillsSegments = ['.claude', 'skills']
const targetSkillsPrefix = `${targetSkillsSegments.join('/')}/`
// Dashi alone writes this branch, so it is reset to each new copy rather than stacked on.
export const workflowSkillsBranch = 'chore/workflow-skills'
const commitMessage = "chore: add agent-base's workflow skills"
const pullRequestTitle = "chore: add agent-base's workflow skills for cloud sessions"
const pullRequestBody = `Copies the skills of [agent-base's workflow plugin](https://github.com/cnotv/agent-base/tree/main/plugins/workflow/skills) into \`.claude/skills/\`, unchanged.

Cloud sessions do not install the plugins a repository enables in \`.claude/settings.json\`, but they do load the skills committed under \`.claude/skills/\`. With these, a session Dashi starts in the cloud can run \`start\`, \`start-issue\`, \`open-pr\` and \`finish-change\` as AGENTS.md asks.

Opened from Dashi's board. When agent-base changes its skills, the board offers the update the same way.`

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
 * Lists the skill files agent-base ships that the repository lacks or holds a different copy of.
 * Git names a file by its content, so a file is the same when its blob sha is.
 * @param sourceEntries agent-base's skill files, by path under the skills directory.
 * @param targetEntries The repository's files under .claude/skills/, by the same paths.
 * @returns The source files to copy.
 */
export const changedSkillEntries = (sourceEntries: TreeEntry[], targetEntries: TreeEntry[]): TreeEntry[] => {
  const targetShaByPath = new Map(targetEntries.map((entry) => [entry.path, entry.sha]))
  return sourceEntries.filter((entry) => targetShaByPath.get(entry.path) !== entry.sha)
}

/**
 * Compares a repository's .claude/skills/ with the skills of agent-base's workflow plugin, and
 * finds the pull request Dashi opened to copy them, if one is still open.
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
  if (sourceEntries.value.length === 0) return failureOf(502, `agent-base has no skills under ${sourceSkillsSegments.join('/')}`)
  const details = await readGithub(fetchGithub, repositoryPath, repositoryDetailsSchema)
  if (!details.ok) return details
  const defaultBranch = details.value.default_branch
  const reference = await readGithub(fetchGithub, `${repositoryPath}/git/ref/heads/${defaultBranch}`, gitReferenceSchema)
  if (!reference.ok) return reference
  const baseCommit = await readGithub(fetchGithub, `${repositoryPath}/git/commits/${reference.value.object.sha}`, gitCommitSchema)
  if (!baseCommit.ok) return baseCommit
  const targetEntries = await readFilesUnder(fetchGithub, repositoryPath, baseCommit.value.tree.sha, targetSkillsSegments)
  if (!targetEntries.ok) return targetEntries
  const changedEntries = changedSkillEntries(sourceEntries.value, targetEntries.value)
  const comparisonBase = { changedEntries, defaultBranch, baseCommitSha: baseCommit.value.sha, baseTreeSha: baseCommit.value.tree.sha }
  if (changedEntries.length === 0) {
    return { ok: true, value: { ...comparisonBase, openPullRequest: null, status: { state: 'current', changedFileCount: 0, pullRequestUrl: null } } }
  }
  const openPullRequests = await readGithub(
    fetchGithub,
    `${repositoryPath}/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${workflowSkillsBranch}`)}`,
    openPullRequestsSchema,
  )
  if (!openPullRequests.ok) return openPullRequests
  const openPullRequest = openPullRequests.value[0] ?? null
  const hasAnySkill = targetEntries.value.some((entry) => sourceEntries.value.some((sourceEntry) => sourceEntry.path === entry.path))
  return {
    ok: true,
    value: {
      ...comparisonBase,
      openPullRequest: openPullRequest === null ? null : { number: openPullRequest.number, url: openPullRequest.html_url },
      status: {
        state: openPullRequest !== null ? 'pull-request-open' : hasAnySkill ? 'outdated' : 'missing',
        changedFileCount: changedEntries.length,
        pullRequestUrl: openPullRequest?.html_url ?? null,
      },
    },
  }
}

/**
 * Says whether a repository carries agent-base's workflow skills, an older copy, or none.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @returns The status, or GitHub's reason for failing.
 */
export const readWorkflowSkillsStatus = async (fetchGithub: GithubRestFetcher, repository: RepositoryReference): Promise<WorkflowSkillsStatusResult> => {
  const comparison = await compareWorkflowSkills(fetchGithub, repository)
  return comparison.ok ? { ok: true, value: comparison.value.status } : comparison
}

// Git names a blob by its content, so the copy gets the same sha as agent-base's file.
const copySkillFile = async (fetchGithub: GithubRestFetcher, repositoryPath: string, entry: TreeEntry): Promise<GithubResult<TreeEntry>> => {
  const sourceBlob = await readGithub(fetchGithub, `${agentBasePath}/git/blobs/${entry.sha}`, blobSchema)
  if (!sourceBlob.ok) return sourceBlob
  const copiedBlob = await readGithub(fetchGithub, `${repositoryPath}/git/blobs`, gitObjectSchema, {
    method: 'POST',
    body: { content: sourceBlob.value.content.replaceAll(/\s/g, ''), encoding: 'base64' },
  })
  return copiedBlob.ok ? { ok: true, value: { path: `${targetSkillsPrefix}${entry.path}`, mode: entry.mode, type: 'blob', sha: copiedBlob.value.sha } } : copiedBlob
}

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
 * Opens a pull request that copies agent-base's workflow skills into the repository's
 * .claude/skills/, adding the missing files and replacing older copies; other files there stay.
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
  const { status, openPullRequest, changedEntries, defaultBranch, baseCommitSha, baseTreeSha } = comparison.value
  if (openPullRequest !== null) return { ok: true, value: openPullRequest }
  if (status.state === 'current') return failureOf(409, 'The workflow skills are already up to date')
  const copiedFiles = await Promise.all(changedEntries.map((entry) => copySkillFile(fetchGithub, repositoryPath, entry)))
  const failedCopy = copiedFiles.find((copiedFile) => !copiedFile.ok)
  if (failedCopy !== undefined && !failedCopy.ok) return failedCopy
  const tree = await readGithub(fetchGithub, `${repositoryPath}/git/trees`, gitObjectSchema, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: copiedFiles.flatMap((copiedFile) => (copiedFile.ok ? [copiedFile.value] : [])) },
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
