import { describe, expect, it } from 'vitest'
import type { EpicTicket, IssueReference, IssueSummary, PullRequestSummary } from '@dashi/contracts'
import { buildEpicViewRows, buildTicketRows, closedTicketsOf, epicViewPath, ticketStateOf } from './epic-tickets'

const reference = (number: number, state: IssueReference['state']): IssueReference => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state,
})

const pullRequestOf = (number: number): PullRequestSummary => ({
  number,
  title: `Pull request ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: true,
  headRefName: `feat/${number}-thing`,
  headSha: 'abc',
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  body: '',
  updatedAt: '2026-09-27T10:00:00Z',
  gates: [],
  gateSummary: { passed: 0, failed: 0, pending: 0, total: 0, overallState: 'none' },
  media: { hasImage: false, hasVideo: false },
  previewUrl: null,
})

const ticket = (number: number, blockedBy: IssueReference[] = [], hasPullRequest = false): EpicTicket => ({
  issue: {
    number,
    title: `Issue ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    updatedAt: '2026-09-27T10:00:00Z',
    closedAt: null,
    labels: [],
    linkedPullRequestNumbers: [],
    parent: { number: 1, title: 'Epic', url: 'https://github.com/o/r/issues/1' },
    subIssues: [],
    blockedBy,
  },
  pullRequest: hasPullRequest ? pullRequestOf(90 + number) : null,
})

const numbersAndDepths = (tickets: EpicTicket[]) => buildTicketRows(tickets).map((row) => [row.ticket.issue.number, row.depth])

describe('buildTicketRows', () => {
  it('puts a ticket beneath its open blocker, one level deeper', () => {
    expect(numbersAndDepths([ticket(3, [reference(2, 'open')]), ticket(2, [reference(1, 'open')]), ticket(1)])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ])
  })

  it('lists tickets that wait on the same blocker together, under it', () => {
    expect(numbersAndDepths([ticket(4), ticket(2, [reference(1, 'open')]), ticket(1), ticket(3, [reference(1, 'open')])])).toEqual([
      [4, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ])
  })

  it('treats a closed blocker, or one outside the epic, as no blocker', () => {
    expect(numbersAndDepths([ticket(2, [reference(1, 'closed')]), ticket(3, [reference(99, 'open')])])).toEqual([
      [2, 0],
      [3, 0],
    ])
  })

  it('files a ticket with several open blockers under the first one', () => {
    expect(numbersAndDepths([ticket(3, [reference(1, 'open'), reference(2, 'open')]), ticket(1), ticket(2)])).toEqual([
      [1, 0],
      [3, 1],
      [2, 0],
    ])
  })

  it('still lists tickets that wait on each other', () => {
    expect(numbersAndDepths([ticket(1, [reference(2, 'open')]), ticket(2, [reference(1, 'open')])])).toEqual([
      [1, 0],
      [2, 0],
    ])
  })
})

describe('ticketStateOf', () => {
  it('is in progress once a pull request works on it', () => {
    expect(ticketStateOf(ticket(1, [reference(2, 'open')], true))).toBe('in-progress')
  })

  it('is blocked while a blocker is open and ready once none is', () => {
    expect(ticketStateOf(ticket(1, [reference(2, 'open')]))).toBe('blocked')
    expect(ticketStateOf(ticket(1, [reference(2, 'closed')]))).toBe('ready')
  })
})

describe('closedTicketsOf', () => {
  it('lists the closed sub-issues of an epic', () => {
    const epic: IssueSummary = { ...ticket(1).issue, subIssues: [reference(2, 'closed'), reference(3, 'open')] }
    expect(closedTicketsOf(epic).map((closed) => closed.number)).toEqual([2])
  })
})

describe('buildEpicViewRows', () => {
  it('lists blockers first with each ticket state, then the closed tickets', () => {
    const epic: IssueSummary = { ...ticket(1).issue, subIssues: [reference(5, 'closed'), reference(2, 'open'), reference(3, 'open'), reference(4, 'open')] }
    const rows = buildEpicViewRows(epic, [ticket(3, [reference(2, 'open')]), ticket(2), ticket(4, [], true)])
    expect(rows.map((row) => [row.number, row.depth, row.state, row.blockers.map((blocker) => blocker.number), row.pullRequestNumber])).toEqual([
      [2, 0, 'ready', [], null],
      [3, 1, 'blocked', [2], null],
      [4, 0, 'in-progress', [], 94],
      [5, 0, 'closed', [], null],
    ])
  })
})

describe('epicViewPath', () => {
  it('addresses an epic by its repository and number', () => {
    expect(epicViewPath({ owner: 'cnotv', name: 'dashi' }, 130)).toBe('/epics/cnotv/dashi/130')
  })
})
