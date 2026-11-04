import type { EpicTicket, IssueReference, IssueSummary, RepositoryReference } from '@dashi/contracts'
import { isReadyTicket, openBlockers } from './issue-relations'
import type { EpicTicketState, EpicViewRow, TicketRow } from './types'

/**
 * Where a ticket stands: worked on once a pull request exists, otherwise ready or blocked.
 * @param ticket An open ticket of an epic.
 * @returns Its state.
 */
export const ticketStateOf = ({ issue, pullRequest }: EpicTicket): Exclude<EpicTicketState, 'closed'> =>
  pullRequest !== null ? 'in-progress' : isReadyTicket(issue) ? 'ready' : 'blocked'

const blockerNumberIn = (ticket: EpicTicket, tickets: EpicTicket[]): number | undefined =>
  openBlockers(ticket.issue).find((blocker) => tickets.some((other) => other.issue.number === blocker.number))?.number

/**
 * Orders an epic's open tickets blockers first: a ticket waiting on another sits right beneath it,
 * one level deeper, so the order and the indent say what blocks what. A ticket with several open
 * blockers goes under the first of them; one whose blocker is closed or outside the epic is a
 * top level ticket. Tickets that wait on each other in a circle are listed flat, not lost.
 * @param tickets The epic's open tickets.
 * @returns The tickets in display order with their depth.
 */
export const buildTicketRows = (tickets: EpicTicket[]): TicketRow[] => {
  const rowsBeneath = (blockerNumber: number | undefined, depth: number, trail: number[]): TicketRow[] =>
    tickets
      .filter((ticket) => blockerNumberIn(ticket, tickets) === blockerNumber && !trail.includes(ticket.issue.number))
      .flatMap((ticket) => [{ ticket, depth }, ...rowsBeneath(ticket.issue.number, depth + 1, [...trail, ticket.issue.number])])
  const nested = rowsBeneath(undefined, 0, [])
  const stranded = tickets.filter((ticket) => !nested.some((row) => row.ticket === ticket)).map((ticket) => ({ ticket, depth: 0 }))
  return [...nested, ...stranded]
}

/**
 * The tickets of an epic that are already closed.
 * @param epic The epic.
 * @returns Its closed sub-issues.
 */
export const closedTicketsOf = (epic: IssueSummary): IssueReference[] => epic.subIssues.filter((subIssue) => subIssue.state === 'closed')

/**
 * The address of an epic's own view.
 * @param repository The repository holding the epic.
 * @param epicNumber The epic's issue number.
 * @returns The path, which can be shared and reloaded.
 */
export const epicViewPath = (repository: RepositoryReference, epicNumber: number): string =>
  `/epics/${repository.owner}/${repository.name}/${epicNumber}`

/**
 * One row per ticket of an epic for its own view: the open tickets blockers first, each with its
 * state, its open blockers and its pull request, then the tickets already closed.
 * @param epic The epic.
 * @param tickets Its open tickets.
 * @returns The rows in display order.
 */
export const buildEpicViewRows = (epic: IssueSummary, tickets: EpicTicket[]): EpicViewRow[] => [
  ...buildTicketRows(tickets).map(({ ticket, depth }) => ({
    number: ticket.issue.number,
    title: ticket.issue.title,
    url: ticket.issue.url,
    depth,
    state: ticketStateOf(ticket),
    blockers: openBlockers(ticket.issue),
    pullRequestNumber: ticket.pullRequest?.number ?? null,
    pullRequestUrl: ticket.pullRequest?.url ?? null,
    agentLine: ticket.issue.agentLine,
  })),
  ...closedTicketsOf(epic).map((closed) => ({
    number: closed.number,
    title: closed.title,
    url: closed.url,
    depth: 0,
    state: 'closed' as const,
    blockers: [],
    pullRequestNumber: null,
    pullRequestUrl: null,
    agentLine: { state: 'missing' as const },
  })),
]
