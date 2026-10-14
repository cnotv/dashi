import { describe, expect, it } from 'vitest'
import type { WorkflowSkillsStatus } from '@dashi/contracts'
import { repositoriesToAsk, workflowSkillsSentence } from './workflow-skills'

const entryOf = (name: string, status: Partial<WorkflowSkillsStatus>) => ({
  repository: { owner: 'cnotv', name },
  status: { state: 'undeclared' as const, copiedFileCount: 0, pullRequestUrl: null, ...status },
})

describe('repositoriesToAsk', () => {
  it('asks about every repository that does not take its skills from the plugin alone, except the ones dismissed', () => {
    const entries = [entryOf('dashi', {}), entryOf('current', { state: 'current' }), entryOf('old', { state: 'copied', copiedFileCount: 3 })]
    expect(repositoriesToAsk(entries, []).map(({ repository }) => repository.name)).toEqual(['dashi', 'old'])
    expect(repositoriesToAsk(entries, ['cnotv/dashi']).map(({ repository }) => repository.name)).toEqual(['old'])
  })
})

describe('workflowSkillsSentence', () => {
  it('says the plugin is not enabled, how many copies remain, or that the pull request is open', () => {
    expect(workflowSkillsSentence(entryOf('dashi', {}))).toBe("cnotv/dashi does not enable agent-base's workflow plugin in .claude/settings.json.")
    expect(workflowSkillsSentence(entryOf('dashi', { copiedFileCount: 3 }))).toContain("3 files under .claude/skills/ copy the plugin's skills")
    expect(workflowSkillsSentence(entryOf('dashi', { state: 'copied', copiedFileCount: 1 }))).toBe(
      "cnotv/dashi enables agent-base's workflow plugin, but 1 file under .claude/skills/ copies the plugin's skills, which then load twice.",
    )
    expect(workflowSkillsSentence(entryOf('dashi', { state: 'pull-request-open', pullRequestUrl: 'https://github.com/cnotv/dashi/pull/1' }))).toBe(
      "The pull request that takes cnotv/dashi's workflow skills from agent-base's plugin is open.",
    )
  })
})
