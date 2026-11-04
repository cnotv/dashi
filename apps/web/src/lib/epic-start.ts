import type { EpicTicket, RepositoryReference, SessionStart, SessionStartSubmission, StartOptions } from '@dashi/contracts'
import { ticketStateOf } from './epic-tickets'
import { errorMessageOf } from './presentation'
import {
  choicesFromTicketAgent,
  defaultTargetFor,
  issueStartSubmissionFor,
  startModelProblemFor,
  targetAvailabilityFor,
  ticketAgentOf,
} from './start-session'
import type { EpicStartOutcome, EpicStartPlan } from './types'

/**
 * The tickets of an epic that can start now: open, every blocker closed, no pull request, and no
 * start of this repository already queued, claimed or started for them. A start that failed does
 * not hold a ticket back, so it can be tried again.
 * @param repository The repository holding the epic.
 * @param tickets The epic's open tickets.
 * @param starts Every session start on the board.
 * @returns The ready tickets in the order given.
 */
export const readyTicketsToStart = (repository: RepositoryReference, tickets: EpicTicket[], starts: SessionStart[]): EpicTicket[] =>
  tickets.filter(
    (ticket) =>
      ticketStateOf(ticket) === 'ready' &&
      !starts.some(
        (start) =>
          start.issueNumber === ticket.issue.number &&
          start.repository.owner === repository.owner &&
          start.repository.name === repository.name &&
          start.state !== 'failed',
      ),
  )

/**
 * What starting each ticket would send, from its Agent: line, with the dialog's defaults where the
 * line is missing or wrong.
 * @param repository The repository holding the epic.
 * @param tickets The tickets to start.
 * @param options The runners seen and whether the repository has a routine.
 * @returns One plan per ticket.
 */
export const planEpicStarts = (repository: RepositoryReference, tickets: EpicTicket[], options: StartOptions): EpicStartPlan[] =>
  tickets.map(({ issue }) => {
    const choices = choicesFromTicketAgent(ticketAgentOf(issue.agentLine))
    const target = choices.target ?? defaultTargetFor(options)
    const availability = targetAvailabilityFor(target, options, 0)
    return {
      number: issue.number,
      title: issue.title,
      request: issueStartSubmissionFor(repository, issue.number, choices, target, ''),
      problem: availability.isAvailable ? startModelProblemFor(choices, target) : availability.hint,
      lineProblem: issue.agentLine.state === 'invalid' ? issue.agentLine.problem : null,
    }
  })

const startOne = async (plan: EpicStartPlan, startSession: (submission: SessionStartSubmission) => Promise<SessionStart>): Promise<EpicStartOutcome> => {
  try {
    const { state, message } = await startSession(plan.request)
    return { number: plan.number, state, message: state === 'failed' ? (message ?? 'The session did not start') : null }
  } catch (startError) {
    return { number: plan.number, state: 'failed', message: errorMessageOf(startError) }
  }
}

/**
 * Sends each planned start through the start API. A start that fails or throws is reported for
 * its ticket and the others still go.
 * @param plans The ticked plans.
 * @param startSession The start API.
 * @returns One outcome per plan, in the order given.
 */
export const startPlannedTickets = (
  plans: EpicStartPlan[],
  startSession: (submission: SessionStartSubmission) => Promise<SessionStart>,
): Promise<EpicStartOutcome[]> => Promise.all(plans.map((plan) => startOne(plan, startSession)))
