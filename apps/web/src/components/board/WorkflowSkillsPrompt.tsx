import { ExternalLinkIcon, MagicWandIcon } from '@radix-ui/react-icons'
import { Button, Callout, Flex } from '@radix-ui/themes'
import { useState } from 'react'
import type { RepositoryReference } from '@dashi/contracts'
import { useToast } from '@/hooks/useToast'
import { useWorkflowSkills } from '@/hooks/useWorkflowSkills'
import { repositoryKey } from '@/lib/presentation'
import type { RepositoryWorkflowSkills } from '@/lib/types'
import { repositoriesToAsk, workflowSkillsSentence } from '@/lib/workflow-skills'

interface WorkflowSkillsQuestionProps {
  entry: RepositoryWorkflowSkills
  onAdd: (repository: RepositoryReference) => Promise<void>
  onDismiss: (repository: RepositoryReference) => void
}

const WorkflowSkillsQuestion = ({ entry, onAdd, onDismiss }: WorkflowSkillsQuestionProps) => {
  const [isAdding, setIsAdding] = useState(false)
  const { status, repository } = entry
  const add = async (): Promise<void> => {
    setIsAdding(true)
    try {
      await onAdd(repository)
    } finally {
      setIsAdding(false)
    }
  }
  return (
    <Callout.Root color={status.state === 'pull-request-open' ? 'gray' : 'amber'} variant="surface">
      <Callout.Icon>
        <MagicWandIcon />
      </Callout.Icon>
      <Callout.Text>{workflowSkillsSentence(entry)}</Callout.Text>
      <Flex gap="2" wrap="wrap">
        {status.state === 'pull-request-open' && status.pullRequestUrl !== null ? (
          <Button size="1" variant="soft" asChild>
            <a href={status.pullRequestUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon /> Open the pull request
            </a>
          </Button>
        ) : (
          <Button size="1" onClick={() => void add()} loading={isAdding}>
            {status.state === 'outdated' ? 'Update them in a pull request' : 'Add them in a pull request'}
          </Button>
        )}
        <Button size="1" variant="soft" color="gray" onClick={() => onDismiss(repository)}>
          Not now
        </Button>
      </Flex>
    </Callout.Root>
  )
}

/**
 * Asks, above the board, to add agent-base's workflow skills to each shown repository that lacks
 * them or holds an older copy, by a pull request that copies them into .claude/skills/. Not now
 * hides the question until the next visit; while the pull request is open it links to it instead.
 */
export const WorkflowSkillsPrompt = ({ repositories }: { repositories: RepositoryReference[] }) => {
  const toast = useToast()
  const { entries, add } = useWorkflowSkills(repositories)
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([])

  const addSkills = async (repository: RepositoryReference): Promise<void> => {
    try {
      const pullRequest = await add(repository)
      toast.notifySuccess(`Opened pull request #${pullRequest.number} on ${repositoryKey(repository)}`)
    } catch (addError) {
      toast.notifyError(addError)
    }
  }

  const questions = repositoriesToAsk(entries, dismissedKeys)
  if (questions.length === 0) return null
  return (
    <Flex direction="column" gap="2">
      {questions.map((entry) => (
        <WorkflowSkillsQuestion
          key={repositoryKey(entry.repository)}
          entry={entry}
          onAdd={addSkills}
          onDismiss={(repository) => setDismissedKeys((current) => [...current, repositoryKey(repository)])}
        />
      ))}
    </Flex>
  )
}
