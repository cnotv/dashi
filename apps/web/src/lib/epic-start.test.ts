import { describe, expect, it } from 'vitest'
import type { EpicTicket, IssueReference, SessionStart, SessionStartSubmission, StartOptions, TicketAgentLine } from '@dashi/contracts'
import { planEpicStarts, readyTicketsToStart, startPlannedTickets } from './epic-start'

const repository = { owner: 'o', name: 'r' }

const reference = (number: number, state: IssueReference['state']): IssueReference => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state,
})

const ticket = (number: number, blockedBy: IssueReference[] = [], agentLine: TicketAgentLine = { state: 'missing' }): EpicTicket => ({
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
    agentLine,
  },
  pullRequest: null,
})

const startFor = (issueNumber: number, state: SessionStart['state'], repositoryName = 'r'): SessionStart => ({
  repository: { owner: 'o', name: repositoryName },
  issueNumber,
  pullRequestNumber: null,
  workflow: null,
  target: 'laptop-remote-control',
  agent: 'claude',
  permissionMode: 'auto',
  openRouterModel: null,
  opencodeModel: null,
  claudeModel: null,
  note: '',
  startId: `start-${issueNumber}`,
  state,
  runnerLabel: null,
  sessionUrl: null,
  message: null,
  createdAt: '2026-09-27T10:00:00Z',
  updatedAt: '2026-09-27T10:00:00Z',
})

const options: StartOptions = {
  runners: [{ label: 'Mac mini', lastSeenAt: '2026-09-30T10:00:00Z', isOnline: true }],
  routineConfigured: false,
  attachmentLimits: { fileCount: 5, fileTargetBytes: 8 * 1024 * 1024, inlineTargetBytes: 48 * 1024 },
}

describe('readyTicketsToStart', () => {
  it('keeps open tickets whose blockers are all closed', () => {
    const tickets = [ticket(2), ticket(3, [reference(2, 'open')]), ticket(4, [reference(5, 'closed'), reference(2, 'open')]), ticket(6, [reference(5, 'closed')])]
    expect(readyTicketsToStart(repository, tickets, []).map((ready) => ready.issue.number)).toEqual([2, 6])
  })

  it('leaves out a ticket that has a pull request', () => {
    const withPullRequest: EpicTicket = { ...ticket(2), pullRequest: { number: 9 } as NonNullable<EpicTicket['pullRequest']> }
    expect(readyTicketsToStart(repository, [withPullRequest, ticket(3)], []).map((ready) => ready.issue.number)).toEqual([3])
  })

  it('leaves out a ticket whose start is queued, claimed or started, but not one that failed', () => {
    const starts = [startFor(2, 'queued'), startFor(3, 'claimed'), startFor(4, 'started'), startFor(5, 'failed')]
    expect(readyTicketsToStart(repository, [ticket(2), ticket(3), ticket(4), ticket(5), ticket(6)], starts).map((ready) => ready.issue.number)).toEqual([5, 6])
  })

  it('ignores starts of the same issue number in another repository', () => {
    expect(readyTicketsToStart(repository, [ticket(2)], [startFor(2, 'started', 'other')]).map((ready) => ready.issue.number)).toEqual([2])
  })
})

describe('planEpicStarts', () => {
  it('reads agent, target and model from the Agent: line', () => {
    const line: TicketAgentLine = { state: 'set', choice: { agent: 'claude', target: 'laptop-headless', model: 'sonnet' } }
    const [plan] = planEpicStarts(repository, [ticket(2, [], line)], options)
    expect(plan?.request).toMatchObject({ issueNumber: 2, target: 'laptop-headless', agent: 'claude', claudeModel: 'sonnet', openRouterModel: null, opencodeModel: null })
    expect(plan?.problem).toBeNull()
    expect(plan?.lineProblem).toBeNull()
  })

  it('falls back to the dialog defaults for a missing line', () => {
    const [plan] = planEpicStarts(repository, [ticket(2)], options)
    expect(plan?.request).toMatchObject({ target: 'laptop-remote-control', agent: 'claude', claudeModel: null })
  })

  it('reports a wrong line and starts on the defaults', () => {
    const [plan] = planEpicStarts(repository, [ticket(2, [], { state: 'invalid', text: 'Agent: x', problem: 'Unknown agent x' })], options)
    expect(plan?.lineProblem).toBe('Unknown agent x')
    expect(plan?.request.target).toBe('laptop-remote-control')
  })

  it('marks a plan that cannot start where its line says', () => {
    const line: TicketAgentLine = { state: 'set', choice: { agent: 'claude', target: 'cloud-routine', model: null } }
    const [plan] = planEpicStarts(repository, [ticket(2, [], line)], options)
    expect(plan?.problem).toBe('Set up a routine for this repository under Credentials')
  })
})

describe('startPlannedTickets', () => {
  const plans = planEpicStarts(repository, [ticket(2), ticket(3), ticket(4)], options)
  const started = (request: SessionStartSubmission): SessionStart => ({ ...startFor(request.issueNumber ?? 0, 'started'), ...request })

  it('reports each ticket and keeps going when one start fails or throws', async () => {
    const sent: Array<number | null> = []
    const outcomes = await startPlannedTickets(plans, async (request) => {
      sent.push(request.issueNumber)
      if (request.issueNumber === 2) return { ...started(request), state: 'failed', message: 'No runner' }
      if (request.issueNumber === 3) throw new Error('Network down')
      return started(request)
    })
    expect(sent).toEqual([2, 3, 4])
    expect(outcomes.map(({ number, state, message }) => [number, state, message])).toEqual([
      [2, 'failed', 'No runner'],
      [3, 'failed', 'Network down'],
      [4, 'started', null],
    ])
  })
})
