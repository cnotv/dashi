import type { IssueReference, IssueSummary } from '@dashi/contracts'

/**
 * The tickets that still hold an issue back.
 * @param issue The issue.
 * @returns Its blockers that are not closed yet.
 */
export const openBlockers = (issue: IssueSummary): IssueReference[] => issue.blockedBy.filter((blocker) => blocker.state === 'open')

/**
 * Whether a ticket can be started now: it belongs to an epic or is blocked by something, it is
 * still open, and every ticket blocking it is closed. An issue with neither says nothing.
 * @param issue The issue.
 * @returns True for a ticket with nothing left in its way.
 */
export const isReadyTicket = (issue: IssueSummary): boolean =>
  issue.closedAt === null && (issue.parent !== null || issue.blockedBy.length > 0) && openBlockers(issue).length === 0
