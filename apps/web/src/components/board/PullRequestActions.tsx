import { CheckCircledIcon, CrossCircledIcon, Pencil2Icon, PaperPlaneIcon } from '@radix-ui/react-icons'
import { AlertDialog, Button, Flex, IconButton, Tooltip } from '@radix-ui/themes'
import { useState } from 'react'
import type { PullRequestSummary, RepositoryReference } from '@dashi/contracts'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'

interface PullRequestActionsProps {
  repository: RepositoryReference
  pullRequest: PullRequestSummary
  onChanged: () => void
}

// The reason merging is off, or null when GitHub may be asked; GitHub still has the last word on
// checks and reviews, and its refusal is shown as it gives it.
const mergeBlockerOf = (pullRequest: PullRequestSummary): string | null => {
  if (pullRequest.isDraft) return 'A draft cannot be merged; mark it ready for review first'
  if (pullRequest.mergeable === 'CONFLICTING') return 'It has merge conflicts'
  if (pullRequest.headSha === null) return 'Its head commit is not known yet; refresh the board'
  return null
}

/**
 * The draft, Merge and Close icons at the end of a board card's icon row. Back to draft and Ready
 * for review act at once, since each undoes the other; Merge and Close ask for confirmation,
 * because neither is undone from here. Afterwards the board reloads.
 */
export const PullRequestActions = ({ repository, pullRequest, onChanged }: PullRequestActionsProps) => {
  const toast = useToast()
  const [isWorking, setIsWorking] = useState(false)
  const mergeBlocker = mergeBlockerOf(pullRequest)

  const run = async (action: () => Promise<void>, doneMessage: string): Promise<void> => {
    setIsWorking(true)
    try {
      await action()
      toast.notifySuccess(doneMessage)
      onChanged()
    } catch (actionError) {
      toast.notifyError(actionError)
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <Flex gap="2" align="center" ml="auto">
      <Tooltip content={pullRequest.isDraft ? 'Ready for review: the change is done' : 'Back to draft: a change is being made'}>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          disabled={isWorking}
          aria-label={pullRequest.isDraft ? 'Ready for review' : 'Back to draft'}
          onClick={() =>
            void run(
              () => dashboardApi.setPullRequestDraft(repository, pullRequest, !pullRequest.isDraft),
              pullRequest.isDraft ? `#${pullRequest.number} is ready for review` : `#${pullRequest.number} is a draft again`,
            )
          }
        >
          {pullRequest.isDraft ? <PaperPlaneIcon /> : <Pencil2Icon />}
        </IconButton>
      </Tooltip>
      <AlertDialog.Root>
        <Tooltip content={mergeBlocker ?? 'Squash and merge on GitHub'}>
          <span>
            <AlertDialog.Trigger>
              <IconButton size="1" variant="ghost" color="green" disabled={mergeBlocker !== null || isWorking} aria-label="Merge">
                <CheckCircledIcon />
              </IconButton>
            </AlertDialog.Trigger>
          </span>
        </Tooltip>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Merge #{pullRequest.number}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Squash-merges &ldquo;{pullRequest.title}&rdquo; into the default branch. GitHub refuses it if the branch
            moved since the board was loaded, or if its checks or reviews do not allow it yet.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="green"
                onClick={() => void run(() => dashboardApi.mergePullRequest(repository, pullRequest), `#${pullRequest.number} merged`)}
              >
                Merge
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root>
        <Tooltip content="Close without merging">
          <AlertDialog.Trigger>
            <IconButton size="1" variant="ghost" color="red" disabled={isWorking} aria-label="Close">
              <CrossCircledIcon />
            </IconButton>
          </AlertDialog.Trigger>
        </Tooltip>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Close #{pullRequest.number}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Closes &ldquo;{pullRequest.title}&rdquo; without merging it. The branch stays, so it can be reopened on
            GitHub.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() => void run(() => dashboardApi.closePullRequest(repository, pullRequest), `#${pullRequest.number} closed`)}
              >
                Close pull request
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  )
}
