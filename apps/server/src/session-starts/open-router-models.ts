import type { OpenRouterModel } from '@dashi/contracts'
import { openRouterModelPattern } from '@dashi/contracts/open-router'
import { openRouterModelEntrySchema, openRouterModelListSchema } from './schema.ts'
import type { OpenRouterModelFetcher } from './types.ts'

const openRouterModelsUrl = 'https://openrouter.ai/api/v1/models'
const fetchTimeoutMilliseconds = 15_000

// Prices are strings of dollars per token; a router such as openrouter/auto prices itself at -1.
const isFreePrice = (price: string): boolean => Number(price) === 0

const modelOf = (entry: unknown): OpenRouterModel[] => {
  const parsedEntry = openRouterModelEntrySchema.safeParse(entry)
  if (!parsedEntry.success || !openRouterModelPattern.test(parsedEntry.data.id)) return []
  const { id, name, pricing } = parsedEntry.data
  return [{ id, name, isFree: isFreePrice(pricing.prompt) && isFreePrice(pricing.completion) }]
}

/**
 * Reads the models OpenRouter serves from its public list, which needs no key. Only a model whose
 * id the runner would accept is kept, so the dialog never offers one a start cannot send.
 * @returns The models sorted by name, or null when OpenRouter could not be reached or answered something else.
 */
export const fetchOpenRouterModels: OpenRouterModelFetcher = async () => {
  try {
    const listResponse = await fetch(openRouterModelsUrl, { signal: AbortSignal.timeout(fetchTimeoutMilliseconds) })
    if (!listResponse.ok) return null
    const parsedList = openRouterModelListSchema.safeParse(await listResponse.json())
    if (!parsedList.success) return null
    return parsedList.data.data.flatMap(modelOf).toSorted((first, second) => first.name.localeCompare(second.name))
  } catch {
    return null
  }
}

/**
 * Keeps OpenRouter's model list for a while, so opening the Start dialog does not ask OpenRouter
 * every time. A failed read is not kept: the last good list answers instead, or null before there is one.
 * @param fetchModels Reads the list from OpenRouter.
 * @param now The current time in milliseconds.
 * @param cacheMilliseconds How long a list is reused.
 * @returns A reader for the list.
 */
export const createOpenRouterModelCache = (fetchModels: OpenRouterModelFetcher, now: () => number, cacheMilliseconds: number) => {
  const modelCache = new Map<'models', { models: OpenRouterModel[]; storedAt: number }>()
  return async (): Promise<OpenRouterModel[] | null> => {
    const cachedModels = modelCache.get('models')
    if (cachedModels && now() - cachedModels.storedAt < cacheMilliseconds) return cachedModels.models
    const fetchedModels = await fetchModels()
    if (fetchedModels === null) return cachedModels?.models ?? null
    modelCache.set('models', { models: fetchedModels, storedAt: now() })
    return fetchedModels
  }
}
