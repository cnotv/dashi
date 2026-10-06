import { z } from 'zod'

const checkRunContextSchema = z.object({
  __typename: z.literal('CheckRun'),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  detailsUrl: z.string().nullable(),
})

const statusContextSchema = z.object({
  __typename: z.literal('StatusContext'),
  context: z.string(),
  state: z.string(),
  targetUrl: z.string().nullable(),
})

export const rollupContextSchema = z.discriminatedUnion('__typename', [checkRunContextSchema, statusContextSchema])

export const pullRequestNodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  headRefName: z.string(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  body: z.string(),
  updatedAt: z.string(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          oid: z.string(),
          statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(rollupContextSchema.nullable()) }) }).nullable(),
        }),
      }),
    ),
  }),
})

export const issueNodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }),
  closedByPullRequestsReferences: z.object({ nodes: z.array(z.object({ number: z.number() })) }),
})

export const pullRequestBodyHtmlQuery = `
  query PullRequestBodyHtml($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        bodyHTML
      }
    }
  }
`

export const pullRequestBodyHtmlResponseSchema = z.object({
  data: z.object({
    repository: z.object({ pullRequest: z.object({ bodyHTML: z.string() }).nullable() }),
  }),
})

export const graphqlErrorsSchema = z.object({ errors: z.array(z.object({ message: z.string() })).min(1) })

// A closed issue reads the pull requests that reference it in full, so its card can keep the
// merged one's preview, recording and files.
export const closingPullRequestNodeSchema = pullRequestNodeSchema.extend({ merged: z.boolean() })

export const closedIssueNodeSchema = issueNodeSchema.extend({
  closedByPullRequestsReferences: z.object({ nodes: z.array(closingPullRequestNodeSchema) }),
})

export const boardResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      issues: z.object({ nodes: z.array(issueNodeSchema) }),
      closedIssues: z.object({ nodes: z.array(closedIssueNodeSchema) }),
      pullRequests: z.object({ nodes: z.array(pullRequestNodeSchema) }),
    }),
  }),
})

const pullRequestFields = `
  number
  title
  url
  isDraft
  headRefName
  reviewDecision
  mergeable
  body
  updatedAt
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
`

export const boardQuery = `
  query Board($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      issues(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          url
          updatedAt
          closedAt
          labels(first: 10) { nodes { name color } }
          closedByPullRequestsReferences(first: 5, includeClosedPrs: false) { nodes { number } }
        }
      }
      closedIssues: issues(first: 20, states: CLOSED, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          url
          updatedAt
          closedAt
          labels(first: 10) { nodes { name color } }
          closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { ${pullRequestFields} merged } }
        }
      }
      pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { ${pullRequestFields} }
      }
    }
  }
`

export const githubErrorSchema = z.object({ message: z.string() })

export const createdIssueSchema = z.object({ number: z.number().int().positive(), html_url: z.string().url() })

export const pullRequestFileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
  blob_url: z.string(),
})

export const pullRequestFilesPageSchema = z.array(pullRequestFileSchema)

export const pullRequestDraftStateQuery = `
  query PullRequestDraftState($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) { id isDraft }
    }
  }
`

export const convertToDraftMutation = `
  mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) { pullRequest { isDraft } }
  }
`

export const markReadyForReviewMutation = `
  mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) { pullRequest { isDraft } }
  }
`

export const pullRequestDraftStateResponseSchema = z.object({
  data: z.object({
    repository: z.object({ pullRequest: z.object({ id: z.string(), isDraft: z.boolean() }).nullable() }).nullable(),
  }),
})
