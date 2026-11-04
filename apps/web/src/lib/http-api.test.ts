import { describe, expect, it, vi } from 'vitest'
import type { PullRequestSummary } from '@dashi/contracts'
import { createHttpApi } from './http-api'

describe('pullRequestMediaUrl', () => {
  it('names the head commit so the server can find its recording', () => {
    const httpApi = createHttpApi('https://agents.example.com')
    expect(httpApi.pullRequestMediaUrl({ owner: 'cnotv', name: 'dashi' }, { ...samplePullRequest, number: 7, headSha: 'fedc9876' }, 'video')).toBe(
      'https://agents.example.com/api/repositories/cnotv/dashi/pulls/7/media/video?sha=fedc9876',
    )
    expect(httpApi.pullRequestMediaUrl({ owner: 'cnotv', name: 'dashi' }, { ...samplePullRequest, number: 7, headSha: null }, 'image')).toBe(
      'https://agents.example.com/api/repositories/cnotv/dashi/pulls/7/media/image',
    )
  })
})

describe('setTicketAgent', () => {
  it('puts the choice to the ticket route', async () => {
    const sentRequests: { url: string; init: RequestInit | undefined }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      sentRequests.push({ url, init })
      return new Response(null, { status: 204 })
    })
    await createHttpApi('').setTicketAgent({ owner: 'cnotv', name: 'dashi' }, 133, { agent: 'opencode', target: 'laptop-headless', model: null })
    vi.unstubAllGlobals()
    expect(sentRequests).toEqual([
      expect.objectContaining({
        url: '/api/repositories/cnotv/dashi/issues/133/agent',
        init: expect.objectContaining({ method: 'PUT', body: JSON.stringify({ agent: 'opencode', target: 'laptop-headless', model: null }) }),
      }),
    ])
  })
})

describe('mergePullRequest', () => {
  it('sends the title and the head commit the card showed', async () => {
    const sentRequests: { url: string; init: RequestInit | undefined }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      sentRequests.push({ url, init })
      return new Response(null, { status: 204 })
    })
    await createHttpApi('').mergePullRequest(
      { owner: 'cnotv', name: 'dashi' },
      { ...samplePullRequest, number: 7, title: 'feat: thing (#6)', headSha: 'a'.repeat(40) },
    )
    vi.unstubAllGlobals()
    expect(sentRequests).toEqual([
      expect.objectContaining({
        url: '/api/repositories/cnotv/dashi/pulls/7/merge',
        init: expect.objectContaining({ method: 'POST', body: JSON.stringify({ title: 'feat: thing (#6)', headSha: 'a'.repeat(40) }) }),
      }),
    ])
  })
})

const samplePullRequest: PullRequestSummary = {
  number: 1,
  title: 'feat: thing',
  url: 'https://github.com/cnotv/dashi/pull/1',
  isDraft: false,
  headRefName: 'feat/1-thing',
  headSha: null,
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  body: '',
  updatedAt: '2026-09-30T00:00:00Z',
  gates: [],
  gateSummary: { passed: 0, failed: 0, pending: 0, total: 0, overallState: 'none' },
  media: { hasImage: true, hasVideo: true },
  previewUrl: null,
}
