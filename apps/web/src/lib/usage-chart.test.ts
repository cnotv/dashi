import { describe, expect, it } from 'vitest'
import { fillMissingDays, niceAxisTicks, shareOf } from './usage-chart'

const tokens = (total: number) => ({ input: 0, output: total, cacheRead: 0, cacheCreation: 0, total })

const noCost = { usd: 0, unpricedTokens: 0 }

describe('fillMissingDays', () => {
  it('adds the quiet days as zero, in order', () => {
    const filled = fillMissingDays(
      [
        { day: '2026-09-27', tokens: tokens(5), cost: noCost },
        { day: '2026-09-25', tokens: tokens(2), cost: noCost },
      ],
      '2026-09-25T13:00:00.000Z',
      '2026-09-28T09:00:00.000Z',
    )
    expect(filled.map((usage) => [usage.day, usage.tokens.total])).toEqual([
      ['2026-09-25', 2],
      ['2026-09-26', 0],
      ['2026-09-27', 5],
      ['2026-09-28', 0],
    ])
  })
})

describe('niceAxisTicks', () => {
  it('steps on round numbers and clears the largest value', () => {
    expect(niceAxisTicks(3_700_000)).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000])
    expect(niceAxisTicks(90)).toEqual([0, 25, 50, 75, 100])
    expect(niceAxisTicks(8)).toEqual([0, 2, 4, 6, 8])
  })

  it('has a single baseline when there is nothing to show', () => {
    expect(niceAxisTicks(0)).toEqual([0])
  })
})

describe('shareOf', () => {
  it('is zero rather than NaN when the whole is empty', () => {
    expect(shareOf(3, 0)).toBe(0)
    expect(shareOf(1, 4)).toBe(0.25)
  })
})
