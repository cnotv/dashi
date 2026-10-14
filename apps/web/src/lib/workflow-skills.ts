import { repositoryKey } from './presentation'
import type { RepositoryWorkflowSkills } from './types'

/**
 * Picks the repositories the board asks about: those that do not take agent-base's workflow
 * skills from the plugin alone, leaving out the ones dismissed on this visit.
 * @param entries Each shown repository with its skills status.
 * @param dismissedKeys The owner/name keys dismissed with Not now.
 * @returns The repositories to ask about, in the order given.
 */
export const repositoriesToAsk = (entries: RepositoryWorkflowSkills[], dismissedKeys: string[]): RepositoryWorkflowSkills[] =>
  entries.filter(({ repository, status }) => status.state !== 'current' && !dismissedKeys.includes(repositoryKey(repository)))

/**
 * Says what the board's question is about for one repository.
 * @param entry The repository and its skills status.
 * @returns The sentence the question opens with.
 */
export const workflowSkillsSentence = ({ repository, status }: RepositoryWorkflowSkills): string => {
  const name = repositoryKey(repository)
  if (status.state === 'pull-request-open') return `The pull request that takes ${name}'s workflow skills from agent-base's plugin is open.`
  const isOneFile = status.copiedFileCount === 1
  const copiedFiles = `${status.copiedFileCount} ${isOneFile ? 'file' : 'files'} under .claude/skills/ ${isOneFile ? 'copies' : 'copy'} the plugin's skills, which then load twice.`
  if (status.state === 'copied') return `${name} enables agent-base's workflow plugin, but ${copiedFiles}`
  const copies = status.copiedFileCount === 0 ? '' : ` ${copiedFiles}`
  return `${name} does not enable agent-base's workflow plugin in .claude/settings.json.${copies}`
}
