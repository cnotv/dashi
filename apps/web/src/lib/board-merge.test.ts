import { describe, expect, it } from 'vitest'
import type { Board, BoardCard, IssueSummary, SessionStart } from '@dashi/contracts'
import { latestStartForCard, mergeBoards } from './board-merge'

const issueUpdatedAt = (issueNumber: number, updatedAt: string): IssueSummary => ({
  number: issueNumber,
  title: `Issue ${issueNumber}`,
  url: `https://github.com/o/r/issues/${issueNumber}`,
  updatedAt,
  closedAt: null,
  labels: [],
  linkedPullRequestNumbers: [],
})

const issueCard = (issue: IssueSummary): BoardCard => ({ issues: [issue], pullRequest: null, status: 'no-pull-request' })

const startOn = (name: string, issueNumber: number, createdAt: string, overrides: Partial<SessionStart> = {}): SessionStart => ({
  startId: `${name}-${issueNumber}-${createdAt}`,
  repository: { owner: 'cnotv', name },
  issueNumber,
  pullRequestNumber: null,
  workflow: 'feature',
  target: 'laptop-headless',
  permissionMode: 'auto',
  openRouterModel: null,
  note: '',
  state: 'queued',
  runnerLabel: null,
  sessionUrl: null,
  message: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

const boardOf = (name: string, cards: BoardCard[]): Board => ({
  repository: { owner: 'cnotv', name },
  columns: [
    { status: 'no-pull-request', cards },
    { status: 'draft', cards: [] },
  ],
  fetchedAt: '2026-09-30T10:00:00Z',
})

describe('mergeBoards', () => {
  it("puts every repository's cards in the same columns, newest first, each with its repository", () => {
    const merged = mergeBoards([
      boardOf('first', [issueCard(issueUpdatedAt(1, '2026-09-28T00:00:00Z'))]),
      boardOf('second', [issueCard(issueUpdatedAt(2, '2026-09-30T00:00:00Z'))]),
    ], [])
    expect(merged.map((column) => column.status)).toEqual(['no-pull-request', 'started-from-dashi', 'draft'])
    expect(merged[0]?.cards.map(({ card, repository }) => [repository.name, card.issues[0]?.number])).toEqual([
      ['second', 2],
      ['first', 1],
    ])
    expect(merged[1]?.cards).toEqual([])
    expect(merged[2]?.cards).toEqual([])
  })

  it('moves the issues Dashi started a session on to Started from Dashi, newest start first, each with its start', () => {
    const olderStart = startOn('first', 1, '2026-09-29T00:00:00Z', { state: 'failed' })
    const newerStart = startOn('second', 2, '2026-09-30T08:00:00Z')
    const merged = mergeBoards(
      [
        boardOf('first', [issueCard(issueUpdatedAt(1, '2026-09-30T00:00:00Z')), issueCard(issueUpdatedAt(3, '2026-09-28T00:00:00Z'))]),
        boardOf('second', [issueCard(issueUpdatedAt(2, '2026-09-27T00:00:00Z'))]),
      ],
      [newerStart, olderStart, startOn('elsewhere', 3, '2026-09-30T09:00:00Z')],
    )
    expect(merged[0]?.cards.map(({ card, sessionStart }) => [card.issues[0]?.number, sessionStart])).toEqual([[3, null]])
    expect(merged[1]?.cards.map(({ card, repository, sessionStart }) => [repository.name, card.issues[0]?.number, sessionStart])).toEqual([
      ['second', 2, newerStart],
      ['first', 1, olderStart],
    ])
  })

  it('gives no columns before any board has loaded', () => {
    expect(mergeBoards([], [])).toEqual([])
  })
})

describe('latestStartForCard', () => {
  const card = issueCard(issueUpdatedAt(1, '2026-09-30T00:00:00Z'))
  const repository = { owner: 'cnotv', name: 'first' }

  it("picks the newest start on the card's issue, whatever the order of the list", () => {
    const retried = startOn('first', 1, '2026-09-30T10:00:00Z')
    const failed = startOn('first', 1, '2026-09-30T09:00:00Z', { state: 'failed' })
    expect(latestStartForCard([failed, retried], repository, card)).toBe(retried)
    expect(latestStartForCard([failed, retried], { owner: 'CNOTV', name: 'First' }, card)).toBe(retried)
  })

  it('leaves out starts on a pull request, on another issue or in another repository', () => {
    expect(
      latestStartForCard(
        [
          startOn('first', 1, '2026-09-30T10:00:00Z', { pullRequestNumber: 9 }),
          startOn('first', 2, '2026-09-30T10:00:00Z'),
          startOn('second', 1, '2026-09-30T10:00:00Z'),
        ],
        repository,
        card,
      ),
    ).toBeNull()
  })
})
