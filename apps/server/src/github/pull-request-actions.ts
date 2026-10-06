import type { RepositoryReference } from '@dashi/contracts'
import {
  convertToDraftMutation,
  githubErrorSchema,
  graphqlErrorsSchema,
  markReadyForReviewMutation,
  pullRequestDraftStateQuery,
  pullRequestDraftStateResponseSchema,
} from './schema.ts'
import type { GithubRestFetcher, GraphqlFetcher, PullRequestActionResult, PullRequestToMerge } from './types.ts'

const pullRequestPath = (repository: RepositoryReference, pullRequestNumber: number): string =>
  `/repos/${repository.owner}/${repository.name}/pulls/${pullRequestNumber}`

const resultOf = async (response: Response): Promise<PullRequestActionResult> => {
  if (response.ok) return { ok: true }
  const parsedError = githubErrorSchema.safeParse(await response.json().catch(() => null))
  return { ok: false, status: response.status, message: parsedError.success ? parsedError.data.message : `GitHub answered ${response.status}` }
}

/**
 * Squash-merges a pull request, titled as the repository's convention wants it on main: the pull
 * request's title followed by its number. GitHub would otherwise reuse the commit subject when
 * there is a single commit, and the issue number in the title would be lost.
 * The head SHA is sent along, so a push made after the board was read makes GitHub refuse the
 * merge instead of merging code nobody looked at.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @param pullRequest The number, title and head SHA the board showed.
 * @returns Whether GitHub merged it, and its reason when it did not.
 */
export const mergePullRequest = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
  pullRequest: PullRequestToMerge,
): Promise<PullRequestActionResult> =>
  resultOf(
    await fetchGithub(`${pullRequestPath(repository, pullRequest.number)}/merge`, {
      method: 'PUT',
      body: { merge_method: 'squash', commit_title: `${pullRequest.title} (#${pullRequest.number})`, sha: pullRequest.headSha },
    }),
  )

/**
 * Closes a pull request without merging it. Its branch stays, so it can be reopened on GitHub.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @param pullRequestNumber The pull request to close.
 * @returns Whether GitHub closed it, and its reason when it did not.
 */
export const closePullRequest = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
  pullRequestNumber: number,
): Promise<PullRequestActionResult> =>
  resultOf(await fetchGithub(pullRequestPath(repository, pullRequestNumber), { method: 'PATCH', body: { state: 'closed' } }))

const graphqlProblemOf = (rawResponse: unknown): string | null => {
  const parsedErrors = graphqlErrorsSchema.safeParse(rawResponse)
  return parsedErrors.success ? parsedErrors.data.errors.map((graphqlError) => graphqlError.message).join(' ') : null
}

/**
 * Turns a pull request into a draft, or marks a draft ready for review. GitHub's REST API cannot,
 * so it goes through GraphQL: the pull request's id first, then the mutation, skipped when the
 * pull request is already in the asked state.
 * @param fetchGraphql The GraphQL caller, holding the reader's token.
 * @param repository The repository.
 * @param pullRequestNumber The pull request.
 * @param isDraft True to make it a draft, false to mark it ready.
 * @returns Whether GitHub changed it, and its reason when it did not.
 */
export const setPullRequestDraft = async (
  fetchGraphql: GraphqlFetcher,
  repository: RepositoryReference,
  pullRequestNumber: number,
  isDraft: boolean,
): Promise<PullRequestActionResult> => {
  try {
    const rawState = await fetchGraphql(pullRequestDraftStateQuery, { owner: repository.owner, name: repository.name, number: pullRequestNumber })
    const pullRequest = pullRequestDraftStateResponseSchema.safeParse(rawState).data?.data.repository?.pullRequest ?? null
    if (pullRequest === null) return { ok: false, status: 404, message: graphqlProblemOf(rawState) ?? 'GitHub has no such pull request' }
    if (pullRequest.isDraft === isDraft) return { ok: true }
    const rawAnswer = await fetchGraphql(isDraft ? convertToDraftMutation : markReadyForReviewMutation, { pullRequestId: pullRequest.id })
    const problem = graphqlProblemOf(rawAnswer)
    return problem === null ? { ok: true } : { ok: false, status: 403, message: problem }
  } catch (requestError) {
    return { ok: false, status: 502, message: requestError instanceof Error ? requestError.message : String(requestError) }
  }
}
