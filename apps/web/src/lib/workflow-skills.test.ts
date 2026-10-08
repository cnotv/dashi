import { describe, expect, it } from 'vitest'
import type { WorkflowSkillsStatus } from '@dashi/contracts'
import { repositoriesToAsk, workflowSkillsSentence } from './workflow-skills'

const entryOf = (name: string, status: Partial<WorkflowSkillsStatus>) => ({
  repository: { owner: 'cnotv', name },
  status: { state: 'missing' as const, changedFileCount: 12, pullRequestUrl: null, ...status },
})

describe('repositoriesToAsk', () => {
  it('asks about every repository without current skills, except the ones dismissed', () => {
    const entries = [entryOf('dashi', {}), entryOf('current', { state: 'current', changedFileCount: 0 }), entryOf('old', { state: 'outdated' })]
    expect(repositoriesToAsk(entries, []).map(({ repository }) => repository.name)).toEqual(['dashi', 'old'])
    expect(repositoriesToAsk(entries, ['cnotv/dashi']).map(({ repository }) => repository.name)).toEqual(['old'])
  })
})

describe('workflowSkillsSentence', () => {
  it('says what is missing, how much is out of date, or that the pull request is open', () => {
    expect(workflowSkillsSentence(entryOf('dashi', {}))).toContain('cnotv/dashi has no workflow skills')
    expect(workflowSkillsSentence(entryOf('dashi', { state: 'outdated', changedFileCount: 1 }))).toContain('1 file differs')
    expect(workflowSkillsSentence(entryOf('dashi', { state: 'outdated', changedFileCount: 3 }))).toContain('3 files differ')
    expect(workflowSkillsSentence(entryOf('dashi', { state: 'pull-request-open', pullRequestUrl: 'https://github.com/cnotv/dashi/pull/1' }))).toBe(
      'The pull request that adds the workflow skills to cnotv/dashi is open.',
    )
  })
})
