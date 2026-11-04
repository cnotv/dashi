import { Badge, Flex, Link, Text } from '@radix-ui/themes'
import type { EpicTicket, RepositoryReference } from '@dashi/contracts'
import { buildTicketRows, ticketStateOf } from '@/lib/epic-tickets'
import { StartSessionDialog } from './StartSessionDialog'

interface EpicTicketsProps {
  tickets: EpicTicket[]
  repository: RepositoryReference
}

const TicketAction = ({ ticket, repository }: { ticket: EpicTicket; repository: RepositoryReference }) => {
  const state = ticketStateOf(ticket)
  if (state === 'ready') return <StartSessionDialog repository={repository} issue={ticket.issue} />
  if (state === 'in-progress' && ticket.pullRequest) {
    return (
      <Badge color="sky" variant="soft" radius="full" asChild>
        <a href={ticket.pullRequest.url} target="_blank" rel="noopener noreferrer">
          PR #{ticket.pullRequest.number}
        </a>
      </Badge>
    )
  }
  return null
}

/**
 * The open tickets of an epic as rows inside its card, blockers first. A ticket that waits on
 * another sits indented beneath it with a connector, in place of any "blocked" label; a ready one
 * has Start and one with a pull request links to it.
 */
export const EpicTickets = ({ tickets, repository }: EpicTicketsProps) => (
  <Flex asChild direction="column" gap="2">
    <ul className="epic-tickets" aria-label="Tickets">
      {buildTicketRows(tickets).map(({ ticket, depth }) => (
        <li
          key={ticket.issue.number}
          className={depth > 0 ? 'epic-ticket epic-ticket-nested' : 'epic-ticket'}
          style={{ marginInlineStart: `calc(${depth} * var(--space-4))` }}
        >
          <Flex align="center" justify="between" gap="2">
            <Text size="2">
              <Link href={ticket.issue.url} target="_blank" rel="noopener noreferrer" highContrast underline="hover">
                #{ticket.issue.number} {ticket.issue.title}
              </Link>
            </Text>
            <TicketAction ticket={ticket} repository={repository} />
          </Flex>
          {ticket.issue.agentLine.state === 'invalid' && (
            <Text as="div" size="1" color="red">
              Agent line: {ticket.issue.agentLine.problem}
            </Text>
          )}
        </li>
      ))}
    </ul>
  </Flex>
)
