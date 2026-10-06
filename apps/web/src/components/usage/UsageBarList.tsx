import { Card, Flex, Text } from '@radix-ui/themes'
import { formatCompactCount, formatFullCount, formatPercent } from '@/lib/presentation'
import { shareOf } from '@/lib/usage-chart'

// Room kept at the end of the longest bar for its value label.
const valueLabelWidth = 84

export interface UsageBarRow {
  rowKey: string
  label: string
  detail: string
  total: number
}

interface UsageBarListProps {
  title: string
  rows: UsageBarRow[]
  grandTotal: number
  isStale: boolean
}

/** Horizontal bars of token totals, labelled with the value and its share of the whole. */
export const UsageBarList = ({ title, rows, grandTotal, isStale }: UsageBarListProps) => {
  const largestTotal = Math.max(1, ...rows.map((row) => row.total))
  return (
    <Card size="2">
      <Flex direction="column" gap="4" className={isStale ? 'chart-stale' : undefined}>
        <Text size="2" weight="medium">
          {title}
        </Text>
        {rows.length === 0 ? (
          <Text size="2" color="gray">
            No tokens recorded in this period.
          </Text>
        ) : (
          <Flex direction="column" gap="3" asChild>
            <ul className="bar-list">
              {rows.map((row) => (
                <li key={row.rowKey} className="bar-list-row">
                  <div className="bar-list-label">
                    <Text as="div" size="2" truncate title={row.label}>
                      {row.label}
                    </Text>
                    <Text as="div" size="1" color="gray">
                      {row.detail}
                    </Text>
                  </div>
                  <div className="bar-list-track" title={`${formatFullCount(row.total)} tokens`}>
                    <span className="bar-list-bar" style={{ width: `calc((100% - ${valueLabelWidth}px) * ${row.total / largestTotal})` }} />
                    <Text size="1" className="bar-list-value">
                      {formatCompactCount(row.total)}
                      <Text color="gray"> {formatPercent(shareOf(row.total, grandTotal))}</Text>
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          </Flex>
        )}
      </Flex>
    </Card>
  )
}
