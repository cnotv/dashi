import { describe, expect, it } from 'vitest'
import { sampleSecrets } from '@/demo/sample-data'
import { credentialGuides } from './credential-guides'

describe('credentialGuides', () => {
  it('documents every credential the dashboard stores', () => {
    expect(sampleSecrets.every((secret) => credentialGuides[secret.name] !== undefined)).toBe(true)
  })

  it('links every guide to documentation over https', () => {
    const urls = Object.values(credentialGuides).flatMap((guide) => guide.docs.map((link) => link.url))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((url) => new URL(url).protocol === 'https:')).toBe(true)
  })

  it('says plainly which keys nothing in Dashi uses yet', () => {
    const unusedNames = Object.entries(credentialGuides)
      .filter(([, guide]) => !guide.isUsedByDashi)
      .map(([name]) => name)
    expect(unusedNames.toSorted()).toEqual(['anthropic-api-key', 'openai-api-key', 'openrouter-api-key'])
  })
})
