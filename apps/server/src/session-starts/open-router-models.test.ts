import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenRouterModelCache, fetchOpenRouterModels } from './open-router-models.ts'

afterEach(() => vi.unstubAllGlobals())

const priced = (prompt: string, completion: string) => ({ prompt, completion, request: '0' })

describe('fetchOpenRouterModels', () => {
  it('keeps the models a start can send, marks the free ones and sorts them by name', async () => {
    const receivedUrls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      receivedUrls.push(url)
      return Response.json({
        data: [
          { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', pricing: priced('0.00000025', '0.000002'), context_length: 400000 },
          { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', pricing: priced('0', '0') },
          { id: 'openrouter/auto', name: 'Auto Router', pricing: priced('-1', '-1') },
          { id: 'Bad Id/with spaces', name: 'Unsendable', pricing: priced('0', '0') },
          { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5' },
        ],
      })
    })
    expect(await fetchOpenRouterModels()).toEqual([
      { id: 'openrouter/auto', name: 'Auto Router', isFree: false },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', isFree: true },
      { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', isFree: false },
    ])
    expect(receivedUrls).toEqual(['https://openrouter.ai/api/v1/models'])
  })

  it('answers null when OpenRouter fails, answers something else, or cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }))
    expect(await fetchOpenRouterModels()).toBeNull()
    vi.stubGlobal('fetch', async () => Response.json({ models: [] }))
    expect(await fetchOpenRouterModels()).toBeNull()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect(await fetchOpenRouterModels()).toBeNull()
  })
})

describe('createOpenRouterModelCache', () => {
  const freeModel = { id: 'a/b:free', name: 'B (free)', isFree: true }

  it('keeps the last good list when a later read fails, and has nothing before the first one', async () => {
    const clock = { now: 0 }
    const answers: ((typeof freeModel)[] | null)[] = [null, [freeModel], null]
    const readModels = createOpenRouterModelCache(async () => answers.shift() ?? null, () => clock.now, 1000)
    expect(await readModels()).toBeNull()
    expect(await readModels()).toEqual([freeModel])
    clock.now = 2000
    expect(await readModels()).toEqual([freeModel])
  })
})
