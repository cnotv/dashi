import { useEffect, useState } from 'react'
import type { OpenRouterModel, RepositoryReference, StartOptions } from '@dashi/contracts'
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
 * Loads the models OpenRouter serves. The OpenRouter model field calls it, so nothing is read
 * until a start's model is set to OpenRouter.
 * @returns The models, or null until they arrive, and any error.
 */
export const useOpenRouterModels = () => {
  const [result, setResult] = useState<{ models: OpenRouterModel[] | null; errorMessage: string | null }>({ models: null, errorMessage: null })

  useEffect(() => {
    const request = { isCurrent: true }
    dashboardApi
      .listOpenRouterModels()
      .then((models) => request.isCurrent && setResult({ models, errorMessage: null }))
      .catch((loadError: unknown) => request.isCurrent && setResult({ models: null, errorMessage: errorMessageOf(loadError) }))
    return () => {
      request.isCurrent = false
    }
  }, [])

  return result
}

/**
 * Holds the place to run, agent, permission mode and model picked in a start dialog, with the
 * repository's start options and whether the chosen place can take the start.
 * @param repository The repository the session works on.
 * @param isOpen Whether the dialog is open; the options are read only while it is.
 * @param attachmentBytes The size of the files attached to the start.
 * @returns The choices, their setter, the options, the chosen place and its availability, and what keeps the chosen model from being sent.
 */
export const useStartChoices = (repository: RepositoryReference, isOpen: boolean, attachmentBytes: number) => {
  const [choices, setChoices] = useState<StartChoices>({
    target: null,
    agent: 'claude',
    permissionMode: 'auto',
    modelSource: 'default',
    openRouterModel: '',
    opencodeModel: '',
  })
  const { options, errorMessage } = useStartOptions(repository, isOpen)
  const chosenTarget = choices.target ?? (options ? defaultTargetFor(options) : null)
  const chosenAvailability = chosenTarget && options ? targetAvailabilityFor(chosenTarget, options, attachmentBytes) : null
  const modelProblem = chosenTarget ? startModelProblemFor(choices, chosenTarget) : null
  return { choices, setChoices, options, errorMessage, chosenTarget, chosenAvailability, modelProblem }
}
