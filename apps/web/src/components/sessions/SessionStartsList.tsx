import { ChatBubbleIcon, ExternalLinkIcon, InfoCircledIcon, TrashIcon } from '@radix-ui/react-icons'
import { Badge, Card, Flex, Heading, IconButton, Link, Table, Text, Tooltip } from '@radix-ui/themes'
import type { SessionStart } from '@dashi/contracts'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { SourceTags } from '@/components/charts/SourceTags'
import { sessionStartStateColors, sessionStartStateLabels, startTargetLabels } from '@/lib/presentation'
import { canChatWithStart } from '@/lib/session-chat'
import { startsSince } from '@/lib/session-starts'

interface SessionStartsListProps {
  starts: SessionStart[]
  windowHours: number
  windowStartedAt: string
  onOpenChat: (start: SessionStart) => void
  onOpenDetails: (start: SessionStart) => void
  onDeleted: () => void
}

const windowLabelOf = (windowHours: number): string => (windowHours % 24 === 0 && windowHours > 24 ? `${windowHours / 24} days` : `${windowHours} hours`)

const shortIdOf = (start: SessionStart): string => start.startId.slice(0, 8)

const DeleteStartButton = ({ start, onDeleted }: { start: SessionStart } & Pick<SessionStartsListProps, 'onDeleted'>) => {
  const toast = useToast()
  const remove = async (): Promise<void> => {
    try {
      await dashboardApi.deleteSessionStart(start.startId)
      onDeleted()
    } catch (deleteError) {
      toast.notifyError(deleteError)
    }
  }
  return (
    <Tooltip content="Remove from this list">
      <IconButton size="1" variant="ghost" color="gray" aria-label={`Remove ${start.repository.name} ${start.workflow} ${shortIdOf(start)}`} onClick={() => void remove()}>
        <TrashIcon />
      </IconButton>
    </Tooltip>
  )
}

const StartActions = ({
  start,
  onOpenChat,
  onOpenDetails,
  onDeleted,
}: { start: SessionStart } & Pick<SessionStartsListProps, 'onOpenChat' | 'onOpenDetails' | 'onDeleted'>) => (
  <Flex gap="3" align="center">
    <Tooltip content="Details">
      <IconButton
        size="1"
        variant="ghost"
        color={start.state === 'failed' ? 'red' : 'gray'}
        aria-label={`Details of ${start.repository.name} ${start.workflow}`}
        onClick={() => onOpenDetails(start)}
      >
        <InfoCircledIcon />
      </IconButton>
    </Tooltip>
    {canChatWithStart(start) && (
      <Tooltip content="Open the conversation">
        <IconButton size="1" variant="ghost" aria-label={`Chat with ${start.repository.name} ${start.workflow}`} onClick={() => onOpenChat(start)}>
          <ChatBubbleIcon />
        </IconButton>
      </Tooltip>
    )}
    <DeleteStartButton start={start} onDeleted={onDeleted} />
  </Flex>
)

const StartState = ({ start }: { start: SessionStart }) => (
  <Flex direction="column" gap="1" align="start">
    <Badge color={sessionStartStateColors[start.state]} radius="full">
      {sessionStartStateLabels[start.state]}
    </Badge>
    {start.sessionUrl ? (
      <Link href={start.sessionUrl} target="_blank" rel="noopener noreferrer" size="1">
        <Flex gap="1" align="center" asChild>
          <span>
            Open in Claude <ExternalLinkIcon />
          </span>
        </Flex>
      </Link>
    ) : (
      start.message && (
        <Text size="1" color="gray">
          {start.message}
        </Text>
      )
    )}
  </Flex>
)

/**
 * The sessions started from the board inside the page's time window, newest first: where each
 * runs, its state, its link or message, the button that opens its details, and for one running on
 * the laptop the button that opens its conversation.
 */
export const SessionStartsList = ({ starts, windowHours, windowStartedAt, onOpenChat, onOpenDetails, onDeleted }: SessionStartsListProps) => {
  const startsShown = startsSince(starts, windowStartedAt)
  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Heading as="h2" size="3" weight="medium">
            Started from the board
          </Heading>
          <SourceTags sourceIds={['laptop-runner', 'claude-code-routines']} note="Each start's badge says which one ran it" />
        </Flex>
        {startsShown.length === 0 ? (
          <Text size="2" color="gray">
            No starts in the last {windowLabelOf(windowHours)}.
          </Text>
        ) : (
          <Table.Root variant="ghost" size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell aria-label="Details and chat" />
                <Table.ColumnHeaderCell>When</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Work</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Where</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>State</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {startsShown.map((start) => (
                <Table.Row key={start.startId} align="center">
                  <Table.Cell>
                    <StartActions start={start} onOpenChat={onOpenChat} onOpenDetails={onOpenDetails} onDeleted={onDeleted} />
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="1" color="gray">
                      {new Date(start.createdAt).toLocaleString()}
                    </Text>
                  </Table.Cell>
                  <Table.RowHeaderCell>
                    <Text size="2">
                      {start.repository.name}
                      {start.issueNumber === null ? '' : ` #${start.issueNumber}`} · {start.workflow}
                    </Text>
                    <Text size="1" color="gray" as="div">
                      ID {shortIdOf(start)}
                    </Text>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Text size="1">
                      {startTargetLabels[start.target].name}
                      {start.runnerLabel ? ` (${start.runnerLabel})` : ''}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <StartState start={start} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Flex>
    </Card>
  )
}
