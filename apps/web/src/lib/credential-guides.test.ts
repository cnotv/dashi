import { describe, expect, it } from 'vitest'
import { sampleSecrets } from '@/demo/sample-data'
import { credentialGuides, machineGuides } from './credential-guides'

describe('credentialGuides', () => {
  it('documents every credential the dashboard stores', () => {
    expect(sampleSecrets.every((secret) => credentialGuides[secret.name] !== undefined)).toBe(true)
  })

  it('links every guide to documentation over https', () => {
    const urls = Object.values({ ...credentialGuides, ...machineGuides }).flatMap((guide) => guide.docs.map((link) => link.url))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((url) => new URL(url).protocol === 'https:')).toBe(true)
  })

  it('says plainly which keys nothing in Dashi uses yet', () => {
    const unusedNames = Object.entries(credentialGuides)
      .filter(([, guide]) => !guide.isUsedByDashi)
      .map(([name]) => name)
    expect(unusedNames.toSorted()).toEqual(['anthropic-api-key', 'openai-api-key', 'openrouter-api-key'])
  })

  it('documents the three machine panels, each as used by Dashi', () => {
    expect(Object.keys(machineGuides).toSorted()).toEqual(['connect-claude-code', 'laptop-runner', 'machine-setup'])
    expect(Object.values(machineGuides).every((guide) => guide.isUsedByDashi && guide.calls.length > 0)).toBe(true)
  })
})
