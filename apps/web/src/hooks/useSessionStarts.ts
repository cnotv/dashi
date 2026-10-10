import { useEffect, useState } from 'react'
import type { RepositoryReference, StartOptions, StartWorkflow } from '@dashi/contracts'
import { dashboardApi } from '@/lib/api'
import { errorMessageOf } from '@/lib/presentation'
import { defaultTargetFor, startModelProblemFor, targetAvailabilityFor } from '@/lib/start-session'
import type { StartChoices } from '@/lib/types'
import { usePolledResource } from './usePolledResource'

const startsPollMilliseconds = 10_000

/**
 * Loads the sessions started from the board and refreshes them every ten seconds, so a start
 * waiting for the runner turns into a started one without a reload.
 * @param revision Bumped to read the starts again at once, as after a retry.
 * @returns The starts, newest first, and any error.
 */
export const useSessionStarts = (revision: number) =>
  usePolledResource(`session-starts-${revision}`, () => dashboardApi.listSessionStarts(), startsPollMilliseconds)

/**
 * Loads where a session for this repository can run, while the Start dialog is open.
 * @param repository The repository.
 * @param isOpen Whether the dialog is open; nothing is read while it is closed.
 * @returns The options, or null until they arrive, and any error.
 */
export const useStartOptions = (repository: RepositoryReference, isOpen: boolean) => {
  const [result, setResult] = useState<{ options: StartOptions | null; errorMessage: string | null }>({ options: null, errorMessage: null })

  useEffect(() => {
    if (!isOpen) return
    const request = { isCurrent: true }
    dashboardApi
      .readStartOptions(repository)
      .then((options) => request.isCurrent && setResult({ options, errorMessage: null }))
      .catch((loadError: unknown) => request.isCurrent && setResult({ options: null, errorMessage: errorMessageOf(loadError) }))
    return () => {
      request.isCurrent = false
    }
  }, [repository, isOpen])

  return result
}

/**
 * Holds the workflow, place to run and permission mode picked in a start dialog, with the
 * repository's start options and whether the chosen place can take the start.
 * @param repository The repository the session works on.
 * @param isOpen Whether the dialog is open; the options are read only while it is.
 * @param initialWorkflow The workflow picked to begin with.
 * @param attachmentBytes The size of the files attached to the start.
 * @returns The choices, their setter, the options, the chosen place and its availability, and what keeps the chosen model from being sent.
 */
export const useStartChoices = (repository: RepositoryReference, isOpen: boolean, initialWorkflow: StartWorkflow, attachmentBytes: number) => {
  const [choices, setChoices] = useState<StartChoices>({
    workflow: initialWorkflow,
    target: null,
    permissionMode: 'auto',
    modelSource: 'claude-login',
    openRouterModel: '',
  })
  const { options, errorMessage } = useStartOptions(repository, isOpen)
  const chosenTarget = choices.target ?? (options ? defaultTargetFor(options) : null)
  const chosenAvailability = chosenTarget && options ? targetAvailabilityFor(chosenTarget, options, attachmentBytes) : null
  const modelProblem = chosenTarget ? startModelProblemFor(choices, chosenTarget) : null
  return { choices, setChoices, options, errorMessage, chosenTarget, chosenAvailability, modelProblem }
}
