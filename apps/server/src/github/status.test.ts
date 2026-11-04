import { describe, expect, it } from 'vitest'
import type { CheckGate, IssueSummary, PullRequestSummary } from '@dashi/contracts'
import {
  buildBoard,
  buildBoardCards,
  deriveIssueStatus,
  gateStateFromCheckRun,
  gateStateFromStatusContext,
  issueNumberFromBranch,
  summariseGates,
} from './status.ts'

const gate = (state: CheckGate['state']): CheckGate => ({ name: state, state, url: null })

const makeIssue = (number: number, linkedPullRequestNumbers: number[] = []): IssueSummary => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  updatedAt: '2026-09-01T00:00:00Z',
  closedAt: null,
  labels: [],
  linkedPullRequestNumbers,
  parent: null,
  subIssues: [],
  blockedBy: [],
})

const makePullRequest = (overrides: Partial<PullRequestSummary>): PullRequestSummary => {
  const gates = overrides.gates ?? []
  return {
    number: 10,
    title: 'A change',
    url: 'https://github.com/o/r/pull/10',
    isDraft: false,
    headRefName: 'feat/1-thing',
    headSha: 'abc',
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    body: '',
    updatedAt: '2026-09-02T00:00:00Z',
    media: { hasImage: false, hasVideo: false },
    previewUrl: null,
    ...overrides,
    gates,
    gateSummary: summariseGates(gates),
  }
}

describe('issueNumberFromBranch', () => {
  it('reads the number from the branch convention', () => {
    expect(issueNumberFromBranch('feat/42-dashi')).toBe(42)
    expect(issueNumberFromBranch('chore/7-adopt-agent-base')).toBe(7)
  })

  it('returns null for branches outside the convention', () => {
    expect(issueNumberFromBranch('claude/ecstatic-mayer-hmy8li')).toBeNull()
    expect(issueNumberFromBranch('main')).toBeNull()
    expect(issueNumberFromBranch('feature/42-x')).toBeNull()
  })
})

describe('gate states', () => {
  it('maps check runs', () => {
    expect(gateStateFromCheckRun('IN_PROGRESS', null)).toBe('pending')
    expect(gateStateFromCheckRun('COMPLETED', 'SUCCESS')).toBe('success')
    expect(gateStateFromCheckRun('COMPLETED', 'FAILURE')).toBe('failure')
    expect(gateStateFromCheckRun('COMPLETED', 'TIMED_OUT')).toBe('failure')
    expect(gateStateFromCheckRun('COMPLETED', 'SKIPPED')).toBe('skipped')
    expect(gateStateFromCheckRun('COMPLETED', 'NEUTRAL')).toBe('neutral')
  })

  it('maps commit statuses', () => {
    expect(gateStateFromStatusContext('SUCCESS')).toBe('success')
    expect(gateStateFromStatusContext('PENDING')).toBe('pending')
    expect(gateStateFromStatusContext('ERROR')).toBe('failure')
  })
})

describe('summariseGates', () => {
  it('reports none without gates', () => {
    expect(summariseGates([]).overallState).toBe('none')
  })

  it('lets one failure outweigh pending and passing gates', () => {
    expect(summariseGates([gate('success'), gate('pending'), gate('failure')])).toEqual({
      passed: 1,
      failed: 1,
      pending: 1,
      total: 3,
      overallState: 'failing',
    })
  })

  it('is running while anything is pending', () => {
    expect(summariseGates([gate('success'), gate('pending')]).overallState).toBe('running')
  })

  it('passes when skipped and neutral gates are the only non-successes', () => {
    expect(summariseGates([gate('success'), gate('skipped'), gate('neutral')]).overallState).toBe('passing')
  })
})

describe('deriveIssueStatus', () => {
  it('walks the status ladder', () => {
    expect(deriveIssueStatus(null)).toBe('no-pull-request')
    expect(deriveIssueStatus(makePullRequest({ isDraft: true, gates: [gate('failure')] }))).toBe('draft')
    expect(deriveIssueStatus(makePullRequest({ gates: [gate('failure')] }))).toBe('checks-failing')
    expect(deriveIssueStatus(makePullRequest({ gates: [gate('pending')] }))).toBe('checks-running')
    expect(deriveIssueStatus(makePullRequest({ gates: [gate('success')] }))).toBe('ready-for-review')
    expect(deriveIssueStatus(makePullRequest({ reviewDecision: 'APPROVED' }))).toBe('approved')
  })
})

describe('buildBoardCards', () => {
  it('links a pull request by its closing reference', () => {
    const cards = buildBoardCards([makeIssue(5, [10])], [makePullRequest({ headRefName: 'some-branch' })])
    expect(cards).toHaveLength(1)
    expect(cards[0]?.pullRequest?.number).toBe(10)
    expect(cards[0]?.issues.map((issue) => issue.number)).toEqual([5])
  })

  it('links a pull request by its branch name', () => {
    const cards = buildBoardCards([makeIssue(1)], [makePullRequest({ headRefName: 'feat/1-thing' })])
    expect(cards[0]?.pullRequest?.number).toBe(10)
  })

  it('keeps pull requests without an issue as their own cards', () => {
    const cards = buildBoardCards([makeIssue(3)], [makePullRequest({ headRefName: 'claude/something' })])
    expect(cards.map((card) => [card.issues.map((issue) => issue.number), card.pullRequest?.number ?? null])).toEqual([
      [[], 10],
      [[3], null],
    ])
  })

  it('gives a pull request that closes several issues one card listing them all', () => {
    const cards = buildBoardCards([makeIssue(4, [10]), makeIssue(5, [10])], [makePullRequest({ headRefName: 'feat/4-thing' })])
    expect(cards).toHaveLength(1)
    expect(cards[0]?.issues.map((issue) => issue.number)).toEqual([4, 5])
  })

  it('prefers the most recently updated pull request for an issue', () => {
    const cards = buildBoardCards(
      [makeIssue(1)],
      [
        makePullRequest({ number: 10, updatedAt: '2026-09-01T00:00:00Z' }),
        makePullRequest({ number: 11, updatedAt: '2026-09-03T00:00:00Z' }),
      ],
    )
    expect(cards.find((card) => card.issues.length > 0)?.pullRequest?.number).toBe(11)
    expect(cards.find((card) => card.pullRequest?.number === 10)?.issues).toEqual([])
  })
})

describe('buildBoard', () => {
  it('always returns every column in order', () => {
    const board = buildBoard({ owner: 'o', name: 'r' }, { open: [makeIssue(1)], closed: [] }, [], '2026-09-28T00:00:00Z')
    expect(board.columns.map((column) => column.status)).toEqual([
      'no-pull-request',
      'draft',
      'checks-running',
      'checks-failing',
      'ready-for-review',
      'approved',
      'closed',
    ])
    expect(board.columns[0]?.cards).toHaveLength(1)
  })

  it('puts each closed issue on a card of its own in the last column, with the merged pull request that closed it', () => {
    const closedIssue = { ...makeIssue(4, [5]), closedAt: '2026-09-20T00:00:00Z' }
    const closedByHand = { ...makeIssue(3), closedAt: '2026-09-19T00:00:00Z' }
    const mergedPullRequest = makePullRequest({ number: 5, body: 'Closes #4', previewUrl: 'https://deploy-preview-5--r.netlify.app' })
    const board = buildBoard(
      { owner: 'o', name: 'r' },
      {
        open: [],
        closed: [
          { issue: closedIssue, pullRequest: mergedPullRequest },
          { issue: closedByHand, pullRequest: null },
        ],
      },
      [],
      '2026-09-28T00:00:00Z',
    )
    expect(board.columns.at(-1)).toEqual({
      status: 'closed',
      cards: [
        { issues: [closedIssue], pullRequest: mergedPullRequest, status: 'closed' },
        { issues: [closedByHand], pullRequest: null, status: 'closed' },
      ],
    })
  })
})
