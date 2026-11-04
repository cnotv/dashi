import { describe, expect, it } from 'vitest'
import type { IssueReference, IssueSummary } from '@dashi/contracts'
import { isReadyTicket, openBlockers } from './issue-relations'

const blocker = (number: number, state: IssueReference['state']): IssueReference => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state,
})

const issueWith = (relations: Pick<IssueSummary, 'parent' | 'blockedBy'>): IssueSummary => ({
  number: 20,
  title: 'A ticket',
  url: 'https://github.com/o/r/issues/20',
  updatedAt: '2026-09-27T10:00:00Z',
  closedAt: null,
  labels: [],
  linkedPullRequestNumbers: [],
  subIssues: [],
  ...relations,
})

const epic = { number: 10, title: 'An epic', url: 'https://github.com/o/r/issues/10' }

describe('openBlockers', () => {
  it('keeps only the blockers that are still open', () => {
    const issue = issueWith({ parent: epic, blockedBy: [blocker(1, 'open'), blocker(2, 'closed')] })
    expect(openBlockers(issue).map((open) => open.number)).toEqual([1])
  })
})

describe('isReadyTicket', () => {
  it('is ready when every blocker is closed', () => {
    expect(isReadyTicket(issueWith({ parent: epic, blockedBy: [blocker(2, 'closed')] }))).toBe(true)
  })

  it('is ready when a ticket of an epic has no blockers', () => {
    expect(isReadyTicket(issueWith({ parent: epic, blockedBy: [] }))).toBe(true)
  })

  it('is not ready while a blocker is open', () => {
    expect(isReadyTicket(issueWith({ parent: epic, blockedBy: [blocker(1, 'open')] }))).toBe(false)
  })

  it('says nothing about an issue outside any epic and without blockers', () => {
    expect(isReadyTicket(issueWith({ parent: null, blockedBy: [] }))).toBe(false)
  })

  it('is never ready once closed', () => {
    expect(isReadyTicket({ ...issueWith({ parent: epic, blockedBy: [] }), closedAt: '2026-09-28T10:00:00Z' })).toBe(false)
  })
})
