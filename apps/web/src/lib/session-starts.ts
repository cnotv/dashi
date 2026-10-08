import type { RepositoryReference, SessionStart } from '@dashi/contracts'

export const routinesPageUrl = 'https://claude.ai/code/routines'
/**
 * Keeps the starts made inside the Sessions page's time window.
 * @param starts The starts, newest first.
 * @param windowStartedAt When the window begins, as the sessions overview reports it.
 * @returns The starts created in the window, in the same order.
 */
export const startsSince = (starts: SessionStart[], windowStartedAt: string): SessionStart[] =>
  starts.filter((start) => Date.parse(start.createdAt) >= Date.parse(windowStartedAt))

/**
 * Says what to do when the routines API turns a run away, from the reason it gave.
 * @param reason The API's message, such as Authentication failed.
 * @returns The advice.
 */
export const routineFailureAdviceFor = (reason: string): string => {
  const message = reason.toLowerCase()
  if (message.includes('authentication') || message.includes('401')) {
    return "The routine's token no longer matches it: it was regenerated or revoked, or saved for another routine. In claude.ai open the routine, generate a new API token, save it under Credentials, test it there, then retry."
  }
  if (message.includes('rate') || message.includes('limit') || message.includes('overloaded')) {
    return 'Anthropic turned the run away for now. Wait a few minutes, then retry.'
  }
  return `Check the routine on claude.ai (${routinesPageUrl}) and its settings under Credentials, then retry.`
}

/**
 * Says what to do about a start that failed, from where it ran and the reason it gave.
 * @param start The start.
 * @returns The advice, or null when the start did not fail.
 */
export const failureAdviceFor = (start: SessionStart): string | null => {
  if (start.state !== 'failed') return null
  if (start.target === 'cloud-routine') return routineFailureAdviceFor(start.message ?? '')
  return "Read the runner's log on the laptop, ~/dashi/runner.log on macOS or journalctl --user -u dashi-runner on Linux, fix what it says, then retry."
}

/**
 * Finds the session to resume from a board card: the newest start that has a session link and was
 * made for one of the card's issues or for its pull request.
 * @param starts The starts, newest first.
 * @param repository The repository the card belongs to.
 * @param issueNumbers The issues the card shows.
 * @param pullRequestNumber The card's pull request, or null.
 * @returns The session link, or null when no start has one.
 */
export const sessionUrlForCard = (
  starts: SessionStart[],
  repository: RepositoryReference,
  issueNumbers: number[],
  pullRequestNumber: number | null,
): string | null =>
  starts.find(
    (start) =>
      start.sessionUrl !== null &&
      start.repository.owner === repository.owner &&
      start.repository.name === repository.name &&
      ((start.issueNumber !== null && issueNumbers.includes(start.issueNumber)) ||
        (start.pullRequestNumber !== null && start.pullRequestNumber === pullRequestNumber)),
  )?.sessionUrl ?? null
