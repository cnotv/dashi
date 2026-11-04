import type { Board, CheckGate, IssueReference, IssueSummary, PullRequestSummary, RepositoryReference } from '@dashi/contracts'
import { deployPreviewUrlFromGates, previewPageUrl } from '../netlify/deploy-preview.ts'
import { parseAgentLine } from './agent-line.ts'
import { proposeAgentLine } from './agent-routing.ts'
import type { AgentRouting } from './agent-routing.ts'
import { mediaPresenceFromMarkdown } from './media.ts'
import { boardQuery, boardResponseSchema, graphqlErrorsSchema, pullRequestBodyHtmlQuery, pullRequestBodyHtmlResponseSchema } from './schema.ts'
import { buildBoard, gateStateFromCheckRun, gateStateFromStatusContext, summariseGates } from './status.ts'
import type { ClosedIssue, ClosedIssueNode, GraphqlFetcher, IssueNode, PullRequestNode, RollupContext } from './types.ts'

const githubGraphqlUrl = 'https://api.github.com/graphql'

/**
 * Turns one entry of a commit's status rollup, a check run or a legacy status, into a gate.
 * @param context The rollup entry from GitHub.
 * @returns The gate's name, state and link.
 */
export const gateFromRollupContext = (context: RollupContext): CheckGate =>
  context.__typename === 'CheckRun'
    ? { name: context.name, state: gateStateFromCheckRun(context.status, context.conclusion), url: context.detailsUrl }
    : { name: context.context, state: gateStateFromStatusContext(context.state), url: context.targetUrl }

/**
 * Turns a pull request from the board query into the summary the board shows.
 * @param node The pull request from GitHub.
 * @returns The summary with its gates and their totals.
 */
export const mapPullRequestNode = (node: PullRequestNode): PullRequestSummary => {
  const headCommit = node.commits.nodes[0]?.commit ?? null
  const gates = (headCommit?.statusCheckRollup?.contexts.nodes ?? []).flatMap((context) =>
    context === null ? [] : [gateFromRollupContext(context)],
  )
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    isDraft: node.isDraft,
    headRefName: node.headRefName,
    headSha: headCommit?.oid ?? null,
    reviewDecision: node.reviewDecision,
    mergeable: node.mergeable,
    body: node.body,
    updatedAt: node.updatedAt,
    gates,
    gateSummary: summariseGates(gates),
    media: mediaPresenceFromMarkdown(node.body),
    previewUrl: previewPageUrl(deployPreviewUrlFromGates(gates), node.body),
  }
}

const mapIssueReferenceNode = (node: IssueNode['blockedBy']['nodes'][number]): IssueReference => ({
  number: node.number,
  title: node.title,
  url: node.url,
  state: node.state === 'OPEN' ? 'open' : 'closed',
})

/**
 * Turns an issue from the board query into the summary the board shows.
 * @param node The issue from GitHub.
 * @param routing The routing rules that propose an agent for an issue with no Agent: line.
 * @returns The summary, with the pull requests that close it.
 */
export const mapIssueNode = (node: IssueNode, routing: AgentRouting): IssueSummary => ({
  number: node.number,
  title: node.title,
  url: node.url,
  updatedAt: node.updatedAt,
  closedAt: node.closedAt,
  labels: node.labels.nodes,
  linkedPullRequestNumbers: node.closedByPullRequestsReferences.nodes.map((reference) => reference.number),
  parent: node.parent,
  subIssues: node.subIssues.nodes.map(mapIssueReferenceNode),
  blockedBy: node.blockedBy.nodes.map(mapIssueReferenceNode),
  agentLine: proposeAgentLine(parseAgentLine(node.body), node.labels.nodes, routing),
})

/**
 * Turns a closed issue from the board query into its summary and the pull request that closed it.
 * @param node The closed issue from GitHub, with the pull requests that reference it.
 * @param routing The routing rules that propose an agent for an issue with no Agent: line.
 * @returns The summary, and the most recently updated merged pull request, or null when the issue
 * was closed by hand.
 */
export const mapClosedIssueNode = (node: ClosedIssueNode, routing: AgentRouting): ClosedIssue => {
  const mergedPullRequest = node.closedByPullRequestsReferences.nodes
    .filter((reference) => reference.merged)
    .toSorted((first, second) => second.updatedAt.localeCompare(first.updatedAt))[0]
  return { issue: mapIssueNode(node, routing), pullRequest: mergedPullRequest === undefined ? null : mapPullRequestNode(mergedPullRequest) }
}

/**
 * Creates a GraphQL caller that reads GitHub with one token.
 * @param token A user token or the stored GitHub token.
 * @returns The fetcher, which throws on any non-2xx answer.
 */
export const createGithubGraphqlFetcher =
  (token: string): GraphqlFetcher =>
  async (query, variables) => {
    const githubResponse = await fetch(githubGraphqlUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'dashi' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    })
    if (!githubResponse.ok) throw new Error(`GitHub answered ${githubResponse.status}`)
    return githubResponse.json()
  }

// GitHub answers a repository it cannot see with repository: null and a reason in errors; a
// renamed repository or an App not installed on it look the same, so the message names both.
const boardErrorMessageOf = (rawResponse: unknown, repository: RepositoryReference): string => {
  const repositoryName = `${repository.owner}/${repository.name}`
  const parsedErrors = graphqlErrorsSchema.safeParse(rawResponse)
  if (!parsedErrors.success) return `Unexpected GitHub response for ${repositoryName}`
  const githubReasons = parsedErrors.data.errors.map((graphqlError) => graphqlError.message).join(' ')
  return `${githubReasons} Check that ${repositoryName} in config/repos.json is the repository's current name and that the GitHub App is installed on it.`
}

/**
 * Reads a repository's open issues and pull requests, and its most recently closed issues, in one
 * query and sorts them into board columns.
 * @param fetchGraphql The GraphQL caller.
 * @param repository The repository to read.
 * @param routing The routing rules that propose an agent for an issue with no Agent: line.
 * @returns The board.
 */
export const fetchRepositoryBoard = async (fetchGraphql: GraphqlFetcher, repository: RepositoryReference, routing: AgentRouting): Promise<Board> => {
  const rawResponse = await fetchGraphql(boardQuery, { owner: repository.owner, name: repository.name })
  const parsedResponse = boardResponseSchema.safeParse(rawResponse)
  if (!parsedResponse.success) throw new Error(boardErrorMessageOf(rawResponse, repository))
  const { issues, closedIssues, pullRequests } = parsedResponse.data.data.repository
  return buildBoard(
    repository,
    {
      open: issues.nodes.map((node) => mapIssueNode(node, routing)),
      closed: closedIssues.nodes.map((node) => mapClosedIssueNode(node, routing)),
    },
    pullRequests.nodes.map(mapPullRequestNode),
    new Date().toISOString(),
  )
}

/**
 * Reads GitHub's own rendering of a pull request body, whose attachment links are signed for the reader.
 * @param fetchGraphql The GraphQL caller, holding the reader's token.
 * @param repository The repository.
 * @param pullRequestNumber The pull request number.
 * @returns The body as HTML, or null when the pull request does not exist.
 */
export const fetchPullRequestBodyHtml = async (
  fetchGraphql: GraphqlFetcher,
  repository: RepositoryReference,
  pullRequestNumber: number,
): Promise<string | null> => {
  const rawResponse = await fetchGraphql(pullRequestBodyHtmlQuery, {
    owner: repository.owner,
    name: repository.name,
    number: pullRequestNumber,
  })
  const parsedResponse = pullRequestBodyHtmlResponseSchema.safeParse(rawResponse)
  if (!parsedResponse.success) throw new Error(`Unexpected GitHub response for pull request ${pullRequestNumber}`)
  return parsedResponse.data.data.repository.pullRequest?.bodyHTML ?? null
}
