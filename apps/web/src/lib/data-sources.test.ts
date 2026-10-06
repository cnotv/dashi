import { describe, expect, it } from 'vitest'
import { dataSources } from './data-sources'

describe('dataSources', () => {
  it('links every source to documentation over https', () => {
    expect(Object.values(dataSources).every((source) => new URL(source.docsUrl).protocol === 'https:')).toBe(true)
  })

  it('names each source differently, so tags side by side can be told apart', () => {
    const labels = Object.values(dataSources).map((source) => source.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
