import { ExclamationTriangleIcon, PlayIcon } from '@radix-ui/react-icons'
import { Button, Code, Dialog, Flex, IconButton, Text, TextArea, Tooltip } from '@radix-ui/themes'
import { useState, type FormEvent } from 'react'
import type { IssueSummary, PullRequestSummary, RepositoryReference, SessionStart } from '@dashi/contracts'
import { useStartChoices } from '@/hooks/useSessionStarts'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { openRouterModelFor, suggestedWorkflowFor } from '@/lib/start-session'
import { StartChoicesFields } from './StartChoicesFields'
import { StartedSummary } from './StartedSummary'

interface StartSessionDialogProps {
  repository: RepositoryReference
  issue: IssueSummary | null
  conflictingPullRequest?: PullRequestSummary
}

/**
 * The Start button on a board card and its dialog: pick a workflow, where the session runs and
 * an optional note, then start it on the laptop runner or a Claude Code routine. Given a pull
 * request with merge conflicts, it is that pull request's red warning instead, and starts the
 * conflicts workflow on its branch.
 */
export const StartSessionDialog = ({ repository, issue, conflictingPullRequest }: StartSessionDialogProps) => {
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [started, setStarted] = useState<SessionStart | null>(null)
  const [note, setNote] = useState('')
  const initialWorkflow = conflictingPullRequest ? 'conflicts' : suggestedWorkflowFor(issue?.labels ?? [])
  const { choices, setChoices, options, errorMessage, chosenTarget, chosenAvailability, modelProblem } = useStartChoices(repository, isOpen, initialWorkflow, 0)
  const triggerLabel = conflictingPullRequest ? 'Merge conflict: start a session to fix it' : 'Start a session'
  const dialogTitle = conflictingPullRequest
    ? `Fix the conflicts in #${conflictingPullRequest.number}`
    : issue
      ? `Start #${issue.number}`
      : 'Start a session'

  const changeOpen = (nextOpen: boolean): void => {
    setIsOpen(nextOpen)
    if (!nextOpen) setStarted(null)
  }

  const start = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault()
    if (chosenTarget === null) return
    setIsStarting(true)
    try {
      const sessionStart = await dashboardApi.startSession({
        repository,
        issueNumber: issue?.number ?? null,
        pullRequestNumber: conflictingPullRequest?.number ?? null,
        workflow: choices.workflow,
        target: chosenTarget,
        permissionMode: choices.permissionMode,
        openRouterModel: openRouterModelFor(choices, chosenTarget),
        note,
        attachments: [],
      })
      if (sessionStart.state === 'failed') toast.notifyError(sessionStart.message ?? 'The session did not start')
      setStarted(sessionStart)
    } catch (startError) {
      toast.notifyError(startError)
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={changeOpen}>
      <Tooltip content={triggerLabel}>
        <Dialog.Trigger>
          <IconButton size="1" variant="ghost" color={conflictingPullRequest ? 'red' : undefined} aria-label={triggerLabel}>
            {conflictingPullRequest ? <ExclamationTriangleIcon /> : <PlayIcon />}
          </IconButton>
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{dialogTitle}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          {conflictingPullRequest?.title ?? issue?.title ?? `${repository.owner}/${repository.name}`}
        </Dialog.Description>
        {started ? (
          <Flex direction="column" gap="4">
            <StartedSummary start={started} />
            <Flex justify="end">
              <Dialog.Close>
                <Button>Done</Button>
              </Dialog.Close>
            </Flex>
          </Flex>
        ) : (
          <form onSubmit={(submitEvent) => void start(submitEvent)}>
            <Flex direction="column" gap="4">
              {conflictingPullRequest && (
                <Text size="2">
                  The session checks out <Code>{conflictingPullRequest.headRefName}</Code>, brings in the default branch,
                  resolves the conflicts, runs the checks and pushes. It asks you when both sides changed the same logic. The
                  pull request goes back to draft until the session marks it ready again.
                </Text>
              )}
              <StartChoicesFields
                choices={choices}
                onChange={setChoices}
                options={options}
                optionsError={errorMessage}
                chosenTarget={chosenTarget}
                chosenAvailability={chosenAvailability}
                attachmentBytes={0}
                modelProblem={modelProblem}
                showsWorkflow={!conflictingPullRequest}
              />
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Note for the session
                </Text>
                <TextArea
                  maxLength={2000}
                  placeholder="Optional: anything the issue does not say"
                  value={note}
                  onChange={(changeEvent) => setNote(changeEvent.target.value)}
                />
              </label>
              <Flex gap="3" justify="end">
                <Dialog.Close>
                  <Button type="button" variant="soft" color="gray">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" loading={isStarting} disabled={chosenAvailability?.isAvailable !== true || modelProblem !== null}>
                  <PlayIcon /> Start
                </Button>
              </Flex>
            </Flex>
          </form>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}
