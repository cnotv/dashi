import { Card, Flex, Text } from '@radix-ui/themes'
import { createColumnHelper } from '@tanstack/react-table'
import type { UsageByDay } from '@dashi/contracts'
import { SortableTable } from '@/components/tables/SortableTable'
import type { sortableTableFeatures } from '@/components/tables/sortable-table-features'
import { formatCompactCount, formatCost } from '@/lib/presentation'

const columnHelper = createColumnHelper<typeof sortableTableFeatures, UsageByDay>()

const costByDayColumns = columnHelper.columns([
  columnHelper.accessor('day', { header: 'Day', sortFn: 'alphanumeric' }),
  columnHelper.accessor((usage) => usage.tokens.total, {
    id: 'tokens',
    header: 'Tokens',
    sortFn: 'basic',
    cell: ({ getValue }) => formatCompactCount(getValue()),
  }),
  columnHelper.accessor((usage) => usage.cost.usd, {
    id: 'cost',
    header: 'Cost',
    sortFn: 'basic',
    cell: ({ row }) => formatCost(row.original.cost),
  }),
])

/** What each day cost, newest first, as a table so the figures are readable without hovering a chart. */
export const UsageCostByDayTable = ({ days }: { days: UsageByDay[] }) => (
  <Card size="2">
    <Flex direction="column" gap="3">
      <Text size="2" weight="medium">
        Cost per day
      </Text>
      <SortableTable columns={costByDayColumns} rows={[...days].reverse()} rowKeyOf={(usage) => usage.day} numericColumnIds={['tokens', 'cost']} />
    </Flex>
  </Card>
)
