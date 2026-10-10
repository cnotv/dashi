import { describe, expect, it } from 'vitest'
import type { SessionStart } from '@dashi/contracts'
import { failureAdviceFor, startsSince } from './session-starts'

const startAt = (createdAt: string, overrides: Partial<SessionStart> = {}): SessionStart => ({
  startId: createdAt,
  repository: { owner: 'cnotv', name: 'dashi' },
  issueNumber: 55,
  pullRequestNumber: null,
  workflow: 'feature',
  target: 'cloud-routine',
  agent: 'claude',
  permissionMode: 'auto',
  openRouterModel: null,
  note: '',
  state: 'started',
  runnerLabel: null,
  sessionUrl: null,
  message: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

describe('startsSince', () => {
  it('keeps only the starts made inside the window', () => {
    const starts = [startAt('2026-10-02T17:30:00Z'), startAt('2026-10-02T10:00:00Z'), startAt('2026-09-30T22:00:00Z')]
    expect(startsSince(starts, '2026-10-02T12:00:00Z').map((start) => start.createdAt)).toEqual(['2026-10-02T17:30:00Z'])
    expect(startsSince(starts, '2026-10-01T18:00:00Z')).toHaveLength(2)
    expect(startsSince(starts, '2026-09-25T18:00:00Z')).toHaveLength(3)
  })
})

describe('failureAdviceFor', () => {
  it('explains a routine token that no longer matches', () => {
    const failed = startAt('2026-10-02T17:30:00Z', { state: 'failed', message: 'Authentication failed' })
    expect(failureAdviceFor(failed)).toContain('generate a new API token')
  })

  it('points a failed laptop start at the runner log', () => {
    const failed = startAt('2026-10-02T17:30:00Z', { state: 'failed', target: 'laptop-headless', message: 'git clone failed' })
    expect(failureAdviceFor(failed)).toContain('journalctl --user -u dashi-runner')
  })

  it('says nothing for a start that did not fail', () => {
    expect(failureAdviceFor(startAt('2026-10-02T17:30:00Z'))).toBeNull()
  })
})
