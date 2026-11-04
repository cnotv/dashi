import { Badge, Flex, Link, Text } from '@radix-ui/themes'
import { createColumnHelper } from '@tanstack/react-table'
import { SortableTable } from '@/components/tables/SortableTable'
import type { sortableTableFeatures } from '@/components/tables/sortable-table-features'
import { epicTicketStateColors, epicTicketStateLabels } from '@/lib/presentation'
import type { EpicViewRow } from '@/lib/types'

const columnHelper = createColumnHelper<typeof sortableTableFeatures, EpicViewRow>()

// Blockers first is the point of the view, so the headings do not re-sort the rows.
const epicColumns = columnHelper.columns([
  columnHelper.display({
    id: 'ticket',
    header: 'Ticket',
    enableSorting: false,
    cell: ({ row: { original: ticket } }) => (
      <div
        className={ticket.depth > 0 ? 'epic-ticket epic-ticket-nested' : 'epic-ticket'}
        style={{ marginInlineStart: `calc(${ticket.depth} * var(--space-4))` }}
      >
        <Link href={ticket.url} target="_blank" rel="noopener noreferrer" highContrast underline="hover">
          #{ticket.number} {ticket.title}
        </Link>
      </div>
    ),
  }),
  columnHelper.display({
    id: 'state',
    header: 'State',
    enableSorting: false,
    cell: ({ row: { original: ticket } }) => (
      <Badge color={epicTicketStateColors[ticket.state]} variant="soft" radius="full">
        {epicTicketStateLabels[ticket.state]}
      </Badge>
    ),
  }),
  columnHelper.display({
    id: 'blockers',
    header: 'Blocked by',
    enableSorting: false,
    cell: ({ row: { original: ticket } }) =>
      ticket.blockers.length === 0 ? (
        <Text color="gray">None</Text>
      ) : (
        <Flex gap="2" wrap="wrap">
          {ticket.blockers.map((blocker) => (
            <Link key={blocker.number} href={blocker.url} target="_blank" rel="noopener noreferrer" title={blocker.title}>
              #{blocker.number}
            </Link>
          ))}
        </Flex>
      ),
  }),
  columnHelper.display({
    id: 'agent',
    header: 'Agent',
    enableSorting: false,
    // The Agent: line of the ticket body is read by a later change; until then no ticket has one.
    cell: () => <Text color="gray">Not set</Text>,
  }),
  columnHelper.display({
    id: 'pullRequest',
    header: 'Pull request',
    enableSorting: false,
    cell: ({ row: { original: ticket } }) =>
      ticket.pullRequestNumber === null || ticket.pullRequestUrl === null ? (
        <Text color="gray">None</Text>
      ) : (
        <Link href={ticket.pullRequestUrl} target="_blank" rel="noopener noreferrer">
          #{ticket.pullRequestNumber}
        </Link>
      ),
  }),
])

/** An epic's tickets as a table, blockers first, each with its state, blockers, agent and pull request. */
export const EpicTicketsTable = ({ rows }: { rows: EpicViewRow[] }) => (
  <div className="epic-table-scroll">
    <SortableTable columns={epicColumns} rows={rows} rowKeyOf={(row) => String(row.number)} numericColumnIds={[]} />
  </div>
)
