import { Callout, Flex, Grid, SegmentedControl } from '@radix-ui/themes'
import { useSearchParams } from 'react-router'
import type { UsageBySource, UsageReport } from '@dashi/contracts'
import { SourceTags } from '@/components/charts/SourceTags'
import { StatTile } from '@/components/charts/StatTile'
import { UsageBarList, type UsageBarRow } from '@/components/usage/UsageBarList'
import { UsageByDayChart } from '@/components/usage/UsageByDayChart'
import { UsageByWorkTable } from '@/components/usage/UsageByWorkTable'
import { useUsageReport } from '@/hooks/useActivity'
import { formatCompactCount, formatFullCount, repositoryKey } from '@/lib/presentation'
import { fillMissingDays } from '@/lib/usage-chart'

const periodChoices = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

const periodDaysFrom = (value: string | null): number =>
  Number(periodChoices.find((choice) => choice.value === value)?.value ?? 30)

const sessionsLabel = (sessionCount: number): string => (sessionCount === 1 ? '1 session' : `${sessionCount} sessions`)

const repositoryRows = (report: UsageReport): UsageBarRow[] =>
  report.byRepository.map((usage) => ({
    rowKey: usage.repository ? repositoryKey(usage.repository) : 'none',
    label: usage.repository ? repositoryKey(usage.repository) : 'Outside a repository',
    detail: sessionsLabel(usage.sessionCount),
    total: usage.tokens.total,
  }))

const modelRows = (report: UsageReport): UsageBarRow[] =>
  report.byModel.map((usage) => ({
    rowKey: usage.model,
    label: usage.model,
    detail: `${formatCompactCount(usage.tokens.output)} output`,
    total: usage.tokens.total,
  }))

const sourceRows = (rows: UsageBySource[]): UsageBarRow[] =>
  rows.map((usage) => ({
    rowKey: usage.sourceKey,
    label: usage.label,
    detail: usage.note === null ? sessionsLabel(usage.sessionCount) : `${sessionsLabel(usage.sessionCount)} · ${usage.note}`,
    total: usage.tokens.total,
  }))

/** The Usage page: tokens for all repositories, then by day, where they were spent, repository, model and pull request. */
export const UsageView = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const periodDays = periodDaysFrom(searchParams.get('days'))
  const { resource: report, errorMessage, isStale } = useUsageReport(periodDays)

  return (
    <Flex direction="column" gap="5">
      <Flex gap="3" align="center" wrap="wrap">
        <SegmentedControl.Root
          value={String(periodDays)}
          onValueChange={(nextDays) => setSearchParams({ days: nextDays }, { replace: true })}
          aria-label="Period"
        >
          {periodChoices.map((choice) => (
            <SegmentedControl.Item key={choice.value} value={choice.value}>
              {choice.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
        <SourceTags
          sourceIds={['claude-code-otel']}
          note="Every repository together, Claude Code sessions only: Codex sends no token metrics. Subscription sessions have no per-token price."
        />
      </Flex>

      {errorMessage && (
        <Callout.Root color="red" variant="surface">
          <Callout.Text>{errorMessage}</Callout.Text>
        </Callout.Root>
      )}

      {report && (
        <>
          <Grid columns={{ initial: '2', md: '5' }} gap="4">
            <StatTile
              label="Tokens, all repositories"
              value={formatCompactCount(report.totals.total)}
              detail={`${formatFullCount(report.totals.total)} in ${sessionsLabel(report.sessionCount)}`}
              isHero
            />
            <StatTile label="Input" value={formatCompactCount(report.totals.input)} />
            <StatTile label="Output" value={formatCompactCount(report.totals.output)} />
            <StatTile label="Cache read" value={formatCompactCount(report.totals.cacheRead)} />
            <StatTile label="Cache write" value={formatCompactCount(report.totals.cacheCreation)} />
          </Grid>
          <UsageByDayChart days={fillMissingDays(report.byDay, report.windowStartedAt, report.generatedAt)} isStale={isStale} />
          <Grid columns={{ initial: '1', md: '2' }} gap="4">
            <UsageBarList
              title="Triggered by"
              description="What started each session: the Dashi board, an app such as CodePilot, an editor, the Agent SDK or a terminal."
              rows={sourceRows(report.byTrigger)}
              grandTotal={report.totals.total}
              isStale={isStale}
            />
            <UsageBarList
              title="Billed through"
              description="What paid for the tokens: a Claude login (subscription or Console), an API key, OpenRouter or a cloud provider."
              rows={sourceRows(report.byBilling)}
              grandTotal={report.totals.total}
              isStale={isStale}
            />
            <UsageBarList
              title="By machine"
              description="The connected machine whose Dashi token reported the tokens."
              rows={sourceRows(report.byMachine)}
              grandTotal={report.totals.total}
              isStale={isStale}
            />
            <UsageBarList
              title="By agent"
              description="Claude Code reports its tokens; Codex sends none, so its sessions are counted without them."
              rows={sourceRows(report.byAgent)}
              grandTotal={report.totals.total}
              isStale={isStale}
            />
          </Grid>
          <Grid columns={{ initial: '1', md: '2' }} gap="4">
            <UsageBarList title="By repository" rows={repositoryRows(report)} grandTotal={report.totals.total} isStale={isStale} />
            <UsageBarList title="By model" rows={modelRows(report)} grandTotal={report.totals.total} isStale={isStale} />
          </Grid>
          {report.byWork.length > 0 && <UsageByWorkTable rows={report.byWork} grandTotal={report.totals.total} />}
        </>
      )}
    </Flex>
  )
}
