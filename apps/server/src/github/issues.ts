import type { NewIssueRequest, RepositoryReference, TicketAgent } from '@dashi/contracts'
import { bodyWithAgentLine } from './agent-line.ts'
import { createdIssueSchema, githubErrorSchema, issueBodySchema } from './schema.ts'
import type { GithubRestFetcher, IssueCreationResult, PullRequestActionResult } from './types.ts'

/**
 * Opens an issue with the reader's token, so GitHub shows them as its author.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @param newIssue The title and body.
 * @returns The new issue's number and address, or GitHub's reason for refusing.
 */
export const createIssue = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
  newIssue: NewIssueRequest,
): Promise<IssueCreationResult> => {
  const response = await fetchGithub(`/repos/${repository.owner}/${repository.name}/issues`, { method: 'POST', body: newIssue })
  const responseBody: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsedError = githubErrorSchema.safeParse(responseBody)
    return { ok: false, status: response.status, message: parsedError.success ? parsedError.data.message : `GitHub answered ${response.status}` }
  }
  const parsedIssue = createdIssueSchema.safeParse(responseBody)
  return parsedIssue.success
    ? { ok: true, issue: { number: parsedIssue.data.number, url: parsedIssue.data.html_url } }
    : { ok: false, status: 502, message: 'Unexpected answer from GitHub' }
}

const failureOf = async (response: Response): Promise<Extract<PullRequestActionResult, { ok: false }>> => {
  const parsedError = githubErrorSchema.safeParse(await response.json().catch(() => null))
  return { ok: false, status: response.status, message: parsedError.success ? parsedError.data.message : `GitHub answered ${response.status}` }
}

/**
 * Writes a ticket's agent choice into its issue body as the Agent: line, leaving the rest of the
 * body as it is. The body is read just before it is written, so an edit made a moment ago is kept.
 * @param fetchGithub The REST caller, holding the reader's token.
 * @param repository The repository.
 * @param issueNumber The ticket's issue number.
 * @param choice The agent, target and model to write.
 * @returns Whether the body was updated, or GitHub's reason for refusing.
 */
export const setIssueAgentLine = async (
  fetchGithub: GithubRestFetcher,
  repository: RepositoryReference,
  issueNumber: number,
  choice: TicketAgent,
): Promise<PullRequestActionResult> => {
  const issuePath = `/repos/${repository.owner}/${repository.name}/issues/${issueNumber}`
  const readResponse = await fetchGithub(issuePath)
  if (!readResponse.ok) return failureOf(readResponse)
  const currentIssue = issueBodySchema.safeParse(await readResponse.json().catch(() => null))
  if (!currentIssue.success) return { ok: false, status: 502, message: 'Unexpected answer from GitHub' }
  const writeResponse = await fetchGithub(issuePath, { method: 'PATCH', body: { body: bodyWithAgentLine(currentIssue.data.body ?? '', choice) } })
  return writeResponse.ok ? { ok: true } : failureOf(writeResponse)
}
