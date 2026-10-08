import type { z } from 'zod'
import type { RepositoryReference, WorkflowSkillsPullRequest, WorkflowSkillsStatus } from '@dashi/contracts'
import type { DashboardSession } from '../auth/types.ts'
import type { GithubRestFetcher } from '../github/types.ts'
import type { treeEntrySchema } from './schema.ts'

export type TreeEntry = z.infer<typeof treeEntrySchema>

export interface GithubFailure {
  status: number
  message: string
}

export type GithubResult<Value> = { ok: true; value: Value } | ({ ok: false } & GithubFailure)

// Where a repository's skills stand against agent-base's: the files to copy, the commit a copy
// builds on, and the pull request already open for one.
export interface WorkflowSkillsComparison {
  status: WorkflowSkillsStatus
  changedEntries: TreeEntry[]
  defaultBranch: string
  baseCommitSha: string
  baseTreeSha: string
  openPullRequest: WorkflowSkillsPullRequest | null
}

export type WorkflowSkillsStatusResult = GithubResult<WorkflowSkillsStatus>

export type WorkflowSkillsPullRequestResult = GithubResult<WorkflowSkillsPullRequest>

export interface WorkflowSkillsDependencies {
  repositories: RepositoryReference[]
  githubTokenOf: (session: DashboardSession | null) => string | null
  createGithubRestFetcher: (token: string) => GithubRestFetcher
  cacheMilliseconds: number
  now: () => number
}
