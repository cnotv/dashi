import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { CostTotals } from '@dashi/contracts'
import { modelPriceTableSchema } from './schema.ts'
import type { ModelPriceTable, StoredTokenSample } from './types.ts'

const tokensPerPrice = 1_000_000

// A provider reports a snapshot as the model id and a date, such as claude-opus-5-5-20261001.
const datedSnapshotSuffix = /^-\d{8}$/

/**
 * Parses and validates the price file's text.
 * @param rawJson The contents of config/model-prices.json.
 * @returns The price table; throws, naming the field, when the text is not JSON or a price is wrong.
 */
export const parseModelPrices = (rawJson: string): ModelPriceTable => {
  const parsed = modelPriceTableSchema.safeParse(JSON.parse(rawJson))
  if (!parsed.success) throw new Error(`config/model-prices.json is not valid:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/**
 * Reads and validates the price file from disk, so a broken file stops the server at startup.
 * @param filePath The path to config/model-prices.json.
 * @returns The price table.
 */
export const loadModelPrices = (filePath: string): ModelPriceTable => parseModelPrices(readFileSync(filePath, 'utf8'))

const pricesOfModel = (model: string, table: ModelPriceTable): ModelPriceTable['models'][string] | undefined => {
  const listedId = Object.keys(table.models).find((id) => model === id || (model.startsWith(id) && datedSnapshotSuffix.test(model.slice(id.length))))
  return listedId === undefined ? undefined : table.models[listedId]
}

/**
 * Turns token samples into dollars. A model that is not in the table adds no cost, only its
 * tokens to the unpriced count, so a missing price never reads as a free session.
 * @param samples The samples to price.
 * @param table The price per million tokens of each model and token type.
 * @returns The cost of the priced samples and how many tokens had no price.
 */
export const costOfSamples = (samples: StoredTokenSample[], table: ModelPriceTable): CostTotals =>
  samples.reduce<CostTotals>(
    (cost, sample) => {
      const prices = pricesOfModel(sample.model, table)
      return prices === undefined
        ? { ...cost, unpricedTokens: cost.unpricedTokens + sample.tokens }
        : { ...cost, usd: cost.usd + (sample.tokens * prices[sample.tokenType]) / tokensPerPrice }
    },
    { usd: 0, unpricedTokens: 0 },
  )
