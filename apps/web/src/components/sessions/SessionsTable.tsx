import { ChatBubbleIcon } from '@radix-ui/react-icons'
import { Badge, Card, Flex, IconButton, Link, Text, Tooltip } from '@radix-ui/themes'
import { createColumnHelper } from '@tanstack/react-table'
import type { AgentSessionSummary, SessionsOverview } from '@dashi/contracts'
import { Link as RouterLink } from 'react-router'
import { SourceTags } from '@/components/charts/SourceTags'
import { ChartLegend } from '@/components/charts/ChartLegend'
import { SortableTable } from '@/components/tables/SortableTable'
import type { sortableTableFeatures } from '@/components/tables/sortable-table-features'
import {
  formatCompactCount,
  formatFullCount,
  formatTimeAgo,
  gitHubIssueUrl,
  providerLabels,
  sessionStateColors,
  sessionStateLabels,
} from '@/lib/presentation'
import { layoutSessionTimeline, sessionDetail, sessionLabel, sessionStateOrder } from '@/lib/session-timeline'
import { formatTickTime, SessionTimelineAxis, SessionTimelineTrack, timelineLegendEntries } from './SessionTimeline'

const columnHelper = createColumnHelper<typeof sortableTableFeatures, AgentSessionSummary>()

const sessionColumns = (now: number, onOpenChat: (session: AgentSessionSummary) => void) =>
  columnHelper.columns([
    columnHelper.display({
      id: 'chat',
      header: '',
      cell: ({ row }) => (
        <Tooltip content="Open the conversation">
          <IconButton
            size="1"
            variant="ghost"
            aria-label={`Chat with ${sessionLabel(row.original)}`}
            onClick={() => onOpenChat(row.original)}
          >
            <ChatBubbleIcon />
          </IconButton>
        </Tooltip>
      ),
    }),
    columnHelper.accessor((session) => sessionLabel(session), {
      id: 'session',
      header: 'Session',
      sortFn: 'alphanumeric',
      cell: ({ row, getValue }) => (
        <>
          <Text as="div" size="2" weight="medium">
            {getValue()}
          </Text>
          <Text as="div" size="1" color="gray">
            {sessionDetail(row.original)}
          </Text>
        </>
      ),
    }),
    columnHelper.accessor((session) => sessionStateOrder[session.state], {
      id: 'state',
      header: 'State',
      sortFn: 'basic',
      cell: ({ row }) => (
        <Badge color={sessionStateColors[row.original.state]} variant="soft" radius="full">
          {sessionStateLabels[row.original.state]}
        </Badge>
      ),
    }),
    columnHelper.accessor((session) => session.issueNumber ?? 0, {
      id: 'issue',
      header: 'Issue',
      sortFn: 'basic',
      cell: ({ row }) =>
        row.original.repository && row.original.issueNumber !== null ? (
          <Link href={gitHubIssueUrl(row.original.repository, row.original.issueNumber)} target="_blank" rel="noopener noreferrer">
            #{row.original.issueNumber}
          </Link>
        ) : (
          <Text color="gray">None</Text>
        ),
    }),
    columnHelper.accessor((session) => providerLabels[session.provider], { id: 'agent', header: 'Agent', sortFn: 'alphanumeric' }),
    columnHelper.accessor('lastEventAt', {
      header: 'Last activity',
      sortFn: 'alphanumeric',
      cell: ({ getValue }) => <Text color="gray">{formatTimeAgo(getValue(), now)}</Text>,
    }),
    columnHelper.accessor((session) => session.tokens.total, {
      id: 'tokens',
      header: 'Tokens',
      sortFn: 'basic',
      cell: ({ row, getValue }) =>
        row.original.provider === 'codex' ? (
          <Text color="gray" title="Codex sends no token metrics">
            n/a
          </Text>
        ) : (
          <span title={`${formatFullCount(getValue())} tokens`}>{formatCompactCount(getValue())}</span>
        ),
    }),
  ])

interface SessionsTableProps {
  overview: SessionsOverview
  isStale: boolean
  onOpenChat: (session: AgentSessionSummary) => void
}

/**
 * Every session in the window as one sortable table, each led by the button that opens its
 * conversation, so it stays in view on a phone. A running session's timeline sits right under its
 * row, read against the time axis under the headings.
 */
export const SessionsTable = ({ overview, isStale, onOpenChat }: SessionsTableProps) => {
  const { lanes, ticks } = layoutSessionTimeline(overview, formatTickTime)
  const laneBySessionId = new Map(lanes.map((lane) => [lane.sessionId, lane]))

  return (
    <Card size="1">
      <Flex direction="column" gap="3" className={isStale ? 'chart-stale' : undefined}>
        <Flex justify="between" align="center" gap="3" wrap="wrap" className="card-heading">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              Sessions over time
            </Text>
            <SourceTags sourceIds={['claude-code-hooks', 'codex-notify', 'claude-code-otel']} note="Tokens: Claude Code only" />
          </Flex>
          <ChartLegend entries={timelineLegendEntries} />
        </Flex>
        {lanes.length === 0 && (
          <Text size="2" color="gray" className="card-heading">
            No session is running right now. A session appears here once its machine reports to this dashboard:{' '}
            <Link asChild>
              <RouterLink to="/credentials">set up a machine with one command</RouterLink>
            </Link>
            .
          </Text>
        )}
        {overview.sessions.length > 0 && (
          <SortableTable
            columns={sessionColumns(Date.parse(overview.generatedAt), onOpenChat)}
            rows={overview.sessions}
            rowKeyOf={(session) => session.sessionId}
            numericColumnIds={['tokens']}
            headerDetail={lanes.length === 0 ? undefined : <SessionTimelineAxis ticks={ticks} />}
            rowDetailOf={(session) => {
              const lane = laneBySessionId.get(session.sessionId)
              return lane === undefined ? null : <SessionTimelineTrack lane={lane} ticks={ticks} />
            }}
          />
        )}
      </Flex>
    </Card>
  )
}
