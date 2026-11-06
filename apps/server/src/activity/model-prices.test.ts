import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { costOfSamples, loadModelPrices, parseModelPrices } from './model-prices.ts'
import type { ModelPriceTable, StoredTokenSample } from './types.ts'

const prices: ModelPriceTable = {
  models: { 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheCreation: 5 } },
}

const sample = (overrides: Partial<StoredTokenSample>): StoredTokenSample => ({
  sessionId: 's1',
  model: 'claude-opus-5-5',
  tokenType: 'input',
  tokens: 1_000_000,
  recordedAt: '2026-11-01T10:00:00.000Z',
  machineTokenId: null,
  account: null,
  launchHint: null,
  ...overrides,
})

describe('costOfSamples', () => {
  it('prices every token type at its own rate per million tokens', () => {
    const samples = [
      sample({ tokenType: 'input', tokens: 500_000 }),
      sample({ tokenType: 'output', tokens: 100_000 }),
      sample({ tokenType: 'cacheRead', tokens: 2_000_000 }),
      sample({ tokenType: 'cacheCreation', tokens: 200_000 }),
    ]
    const cost = costOfSamples(samples, prices)
    expect(cost.usd).toBeCloseTo(2 + 2 + 0.4 + 1)
    expect(cost.unpricedTokens).toBe(0)
  })

  it('prices a dated snapshot of a listed model as the model', () => {
    expect(costOfSamples([sample({ model: 'claude-opus-5-5-20261001' })], prices).usd).toBe(4)
  })

  it('counts the tokens of an unknown model as unpriced and adds nothing for them', () => {
    const cost = costOfSamples([sample({ model: 'openrouter/openai/gpt-5-mini', tokens: 700 }), sample({ tokens: 1_000_000 })], prices)
    expect(cost).toEqual({ usd: 4, unpricedTokens: 700 })
  })

  it('does not take a different model that merely starts with a listed id for it', () => {
    expect(costOfSamples([sample({ model: 'claude-opus-5-5-mini', tokens: 5 })], prices)).toEqual({ usd: 0, unpricedTokens: 5 })
  })
})

describe('the model price file', () => {
  it('ships a file that parses and prices the model the sample data uses', () => {
    const shipped = loadModelPrices(fileURLToPath(new URL('../../../../config/model-prices.json', import.meta.url)))
    expect(Object.keys(shipped.models)).toContain('claude-opus-5-5')
  })

  it('names the field of a price that is not a number', () => {
    const broken = JSON.stringify({ models: { 'claude-opus-5-5': { input: '4', output: 20, cacheRead: 0.2, cacheCreation: 5 } } })
    expect(() => parseModelPrices(broken)).toThrow(/claude-opus-5-5.*input/s)
  })

  it('names a missing token type and refuses a negative price', () => {
    expect(() => parseModelPrices(JSON.stringify({ models: { m: { input: 1, output: 1, cacheRead: 1 } } }))).toThrow(/cacheCreation/)
    expect(() => parseModelPrices(JSON.stringify({ models: { m: { input: -1, output: 1, cacheRead: 1, cacheCreation: 1 } } }))).toThrow(/input/)
  })

  it('refuses text that is not JSON', () => {
    expect(() => parseModelPrices('{')).toThrow()
  })
})
