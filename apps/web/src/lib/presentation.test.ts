import { describe, expect, it } from 'vitest'
import { formatCompactCount, formatCost, formatDuration, formatTimeAgo, parseRepositoryKey, repositoryKey } from './presentation'

describe('repository keys', () => {
  it('round-trips an owner and name', () => {
    expect(parseRepositoryKey(repositoryKey({ owner: 'cnotv', name: 'generative-art' }))).toEqual({
      owner: 'cnotv',
      name: 'generative-art',
    })
  })

  it('rejects malformed keys', () => {
    expect(parseRepositoryKey('cnotv')).toBeNull()
    expect(parseRepositoryKey('a/b/c')).toBeNull()
    expect(parseRepositoryKey('/b')).toBeNull()
  })
})

describe('number and time formats', () => {
  it('keeps small counts exact and compacts large ones', () => {
    expect(formatCompactCount(1284)).toBe('1,284')
    expect(formatCompactCount(12_900)).toBe('12.9K')
    expect(formatCompactCount(4_200_000)).toBe('4.2M')
  })

  it('reads durations in hours and minutes', () => {
    expect(formatDuration(5 * 60_000)).toBe('5 min')
    expect(formatDuration(2 * 60 * 60_000)).toBe('2 h')
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min')
  })

  it('says just now for the last minute', () => {
    const now = Date.parse('2026-09-29T10:00:00Z')
    expect(formatTimeAgo('2026-09-29T09:59:30Z', now)).toBe('just now')
    expect(formatTimeAgo('2026-09-29T09:15:00Z', now)).toBe('45 min ago')
  })
})

describe('cost format', () => {
  it('writes dollars and cents, and small amounts as under a cent', () => {
    expect(formatCost({ usd: 12.4, unpricedTokens: 0 })).toBe('$12.40')
    expect(formatCost({ usd: 0.002, unpricedTokens: 0 })).toBe('<$0.01')
    expect(formatCost({ usd: 0, unpricedTokens: 0 })).toBe('$0.00')
  })

  it('never invents a cost for tokens without a price', () => {
    expect(formatCost({ usd: 0, unpricedTokens: 900 })).toBe('n/a')
    expect(formatCost({ usd: 3, unpricedTokens: 900 })).toBe('$3.00+')
  })
})
