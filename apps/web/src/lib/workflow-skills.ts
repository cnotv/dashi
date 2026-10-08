import { repositoryKey } from './presentation'
import type { RepositoryWorkflowSkills } from './types'

/**
 * Picks the repositories the board asks about: those without agent-base's current workflow
 * skills, leaving out the ones dismissed on this visit.
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
  if (status.state === 'pull-request-open') return `The pull request that adds the workflow skills to ${name} is open.`
  if (status.state === 'outdated') {
    return `${name} has an older copy of agent-base's workflow skills: ${status.changedFileCount} ${status.changedFileCount === 1 ? 'file differs' : 'files differ'}.`
  }
  return `${name} has no workflow skills. Cloud sessions load agent-base's start, open-pr and finish-change only from the repository's .claude/skills/.`
}
