import { Card, Flex, Link, Text } from '@radix-ui/themes'
import { createColumnHelper } from '@tanstack/react-table'
import type { UsageByWork } from '@dashi/contracts'
import { SourceTags } from '@/components/charts/SourceTags'
import { SortableTable } from '@/components/tables/SortableTable'
import type { sortableTableFeatures } from '@/components/tables/sortable-table-features'
import {
  formatCompactCount,
  formatFullCount,
  formatPercent,
  gitHubIssueUrl,
  gitHubPullRequestUrl,
  repositoryKey,
} from '@/lib/presentation'
import { shareOf } from '@/lib/usage-chart'

const workRowKey = (work: UsageByWork): string => `${work.repository ? repositoryKey(work.repository) : ''}#${work.branch ?? ''}`

const GitHubNumberLink = ({ href, value }: { href: string | null; value: number | null }) =>
  href !== null && value !== null ? (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      #{value}
    </Link>
  ) : (
    <Text color="gray">None</Text>
  )

const columnHelper = createColumnHelper<typeof sortableTableFeatures, UsageByWork>()

// The largest share first, one per line; a row that never reported reads as such in gray.
const OriginLabels = ({ labels }: { labels: string[] }) => (
  <>
    {labels.map((label) => (
      <Text key={label} as="div" size="2" color={label === 'Not reported' ? 'gray' : undefined}>
        {label}
      </Text>
    ))}
  </>
)

const workColumns = (grandTotal: number) =>
  columnHelper.columns([
    columnHelper.accessor((work) => work.branch ?? '', {
      id: 'branch',
      header: 'Branch',
      sortFn: 'alphanumeric',
      cell: ({ row }) => (
        <>
          <Text as="div" size="2" weight="medium">
            {row.original.branch ?? 'No branch'}
          </Text>
          <Text as="div" size="1" color="gray">
            {row.original.repository ? repositoryKey(row.original.repository) : 'No repository'}
          </Text>
        </>
      ),
    }),
    columnHelper.accessor((work) => work.issueNumber ?? 0, {
      id: 'issue',
      header: 'Issue',
      sortFn: 'basic',
      cell: ({ row: { original: work } }) => (
        <GitHubNumberLink
          href={work.repository && work.issueNumber !== null ? gitHubIssueUrl(work.repository, work.issueNumber) : null}
          value={work.issueNumber}
        />
      ),
    }),
    columnHelper.accessor((work) => work.pullRequestNumber ?? 0, {
      id: 'pullRequest',
      header: 'Pull request',
      sortFn: 'basic',
      cell: ({ row: { original: work } }) => (
        <GitHubNumberLink
          href={
            work.repository && work.pullRequestNumber !== null ? gitHubPullRequestUrl(work.repository, work.pullRequestNumber) : null
          }
          value={work.pullRequestNumber}
        />
      ),
    }),
    columnHelper.accessor((work) => work.triggeredBy.join(', '), {
      id: 'triggeredBy',
      header: 'Triggered by',
      sortFn: 'alphanumeric',
      cell: ({ row: { original: work } }) => <OriginLabels labels={work.triggeredBy} />,
    }),
    columnHelper.accessor((work) => work.billedThrough.join(', '), {
      id: 'billedThrough',
      header: 'Billed through',
      sortFn: 'alphanumeric',
      cell: ({ row: { original: work } }) => <OriginLabels labels={work.billedThrough} />,
    }),
    columnHelper.accessor('sessionCount', { header: 'Sessions', sortFn: 'basic' }),
    columnHelper.accessor((work) => work.tokens.output, {
      id: 'output',
      header: 'Output',
      sortFn: 'basic',
      cell: ({ getValue }) => formatCompactCount(getValue()),
    }),
    columnHelper.accessor((work) => work.tokens.total, {
      id: 'tokens',
      header: 'Tokens',
      sortFn: 'basic',
      cell: ({ getValue }) => <span title={`${formatFullCount(getValue())} tokens`}>{formatCompactCount(getValue())}</span>,
    }),
    columnHelper.accessor((work) => shareOf(work.tokens.total, grandTotal), {
      id: 'share',
      header: 'Share',
      sortFn: 'basic',
      cell: ({ getValue }) => formatPercent(getValue()),
    }),
  ])

/** Token usage per pull request or branch as a sortable table, linking each issue and pull request. */
export const UsageByWorkTable = ({ rows, grandTotal }: { rows: UsageByWork[]; grandTotal: number }) => (
  <Card size="1">
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1" className="card-heading">
        <Text size="2" weight="medium">
          By pull request and branch
        </Text>
        <SourceTags sourceIds={['claude-code-otel', 'claude-code-hooks', 'github-graphql']} note="Tokens per branch, matched to its open pull request" />
      </Flex>
      <SortableTable
        columns={workColumns(grandTotal)}
        rows={rows}
        rowKeyOf={workRowKey}
        numericColumnIds={['sessionCount', 'output', 'tokens', 'share']}
      />
    </Flex>
  </Card>
)
