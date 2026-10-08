import { useEffect, useState } from 'react'
import type { RepositoryReference, WorkflowSkillsPullRequest } from '@dashi/contracts'
import { dashboardApi } from '@/lib/api'
import { repositoryKey } from '@/lib/presentation'
import type { RepositoryWorkflowSkills } from '@/lib/types'

/**
 * Loads whether each shown repository carries agent-base's workflow skills. A repository whose
 * status cannot be read is left out: the board already shows why GitHub cannot be reached.
 * @param repositories The repositories on the board.
 * @returns Each repository's status, and add, which opens the pull request that copies the skills.
 */
export const useWorkflowSkills = (repositories: RepositoryReference[]) => {
  const [entries, setEntries] = useState<RepositoryWorkflowSkills[]>([])

  useEffect(() => {
    const request = { isCurrent: true }
    Promise.allSettled(repositories.map(async (repository) => ({ repository, status: await dashboardApi.readWorkflowSkills(repository) })))
      .then((outcomes) => request.isCurrent && setEntries(outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))))
      .catch(() => request.isCurrent && setEntries([]))
    return () => {
      request.isCurrent = false
    }
  }, [repositories])

  const add = async (repository: RepositoryReference): Promise<WorkflowSkillsPullRequest> => {
    const pullRequest = await dashboardApi.addWorkflowSkills(repository)
    setEntries((current) =>
      current.map((entry) =>
        repositoryKey(entry.repository) === repositoryKey(repository)
          ? { repository, status: { ...entry.status, state: 'pull-request-open', pullRequestUrl: pullRequest.url } }
          : entry,
      ),
    )
    return pullRequest
  }

  return { entries, add }
}
