import { describe, expect, it } from 'vitest'
import type { Board, BoardCard, IssueSummary } from '@dashi/contracts'
import { mergeBoards } from './board-merge'

const issueUpdatedAt = (issueNumber: number, updatedAt: string): IssueSummary => ({
  number: issueNumber,
  title: `Issue ${issueNumber}`,
  url: `https://github.com/o/r/issues/${issueNumber}`,
  updatedAt,
  closedAt: null,
  labels: [],
  linkedPullRequestNumbers: [],
  parent: null,
  subIssues: [],
  blockedBy: [],
})

const issueCard = (issue: IssueSummary): BoardCard => ({ issues: [issue], pullRequest: null, status: 'no-pull-request' })

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
    ])
    expect(merged.map((column) => column.status)).toEqual(['no-pull-request', 'draft'])
    expect(merged[0]?.cards.map(({ card, repository }) => [repository.name, card.issues[0]?.number])).toEqual([
      ['second', 2],
      ['first', 1],
    ])
    expect(merged[1]?.cards).toEqual([])
  })

  it('gives no columns before any board has loaded', () => {
    expect(mergeBoards([])).toEqual([])
  })
})
