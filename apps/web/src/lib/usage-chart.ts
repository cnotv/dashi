import type { TokenTotals, UsageByDay } from '@dashi/contracts'

const dayMilliseconds = 24 * 60 * 60_000

const emptyTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 })

/**
 * Fills the days without usage in with zero, so the chart shows quiet days as gaps.
 * The server only reports days that had usage; the chart needs the quiet days too, as zero,
 * or a gap in the work would read as no gap at all.
 * @param byDay The days the server reported.
 * @param windowStartedAt Where the period starts.
 * @param generatedAt Where it ends.
 * @returns Every day in the period, in order.
 */
export const fillMissingDays = (byDay: UsageByDay[], windowStartedAt: string, generatedAt: string): UsageByDay[] => {
  const firstDay = Date.parse(`${windowStartedAt.slice(0, 10)}T00:00:00Z`)
  const lastDay = Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`)
  const usageByDayKey = new Map(byDay.map((usage) => [usage.day, usage]))
  const dayCount = Math.max(0, Math.round((lastDay - firstDay) / dayMilliseconds) + 1)
  return Array.from({ length: dayCount }, (_, dayIndex) => {
    const day = new Date(firstDay + dayIndex * dayMilliseconds).toISOString().slice(0, 10)
    return usageByDayKey.get(day) ?? { day, tokens: emptyTotals(), cost: { usd: 0, unpricedTokens: 0 } }
  })
}

const niceStepFactors = [1, 2, 2.5, 5, 10]

/**
 * Picks round axis ticks, stepping by 1, 2, 2.5 or 5 times a power of ten.
 * Axis ticks on round numbers: the step is 1, 2, 2.5 or 5 times a power of ten, chosen so the
 * axis has at most `maximumTickCount` intervals and its top clears the largest value.
 * @param maximumValue The largest value on the chart.
 * @param maximumTickCount The most intervals the axis may have.
 * @returns The tick values from zero to just past the largest value.
 */
export const niceAxisTicks = (maximumValue: number, maximumTickCount = 4): number[] => {
  if (maximumValue <= 0) return [0]
  const roughStep = maximumValue / maximumTickCount
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = (niceStepFactors.find((factor) => factor * magnitude >= roughStep) ?? 10) * magnitude
  return Array.from({ length: Math.ceil(maximumValue / step) + 1 }, (_, tickIndex) => tickIndex * step)
}

/**
 * Divides a part by its whole, giving zero rather than NaN for an empty whole.
 * @param part The part.
 * @param whole The whole.
 * @returns The share, from 0 to 1.
 */
export const shareOf = (part: number, whole: number): number => (whole > 0 ? part / whole : 0)
