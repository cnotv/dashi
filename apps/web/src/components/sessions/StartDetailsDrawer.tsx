import { Cross2Icon, ExternalLinkIcon, ReloadIcon } from '@radix-ui/react-icons'
import { Badge, Button, Callout, Code, DataList, Dialog, Flex, IconButton, Link, Skeleton, Text } from '@radix-ui/themes'
import { useState } from 'react'
import type { SessionStart } from '@dashi/contracts'
import { subjectUrlOf } from '@dashi/contracts/first-message'
import { usePolledResource } from '@/hooks/usePolledResource'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { sessionStartStateColors, sessionStartStateLabels, startAgentLabels, startModelSourceLabels, startTargetLabels } from '@/lib/presentation'
import { failureAdviceFor, routinesPageUrl } from '@/lib/session-starts'

interface StartDetailsDrawerProps {
  start: SessionStart | null
  onClose: () => void
  onRetried: () => void
}

const OutsideLink = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} target="_blank" rel="noopener noreferrer" size="2">
    <Flex gap="1" align="center" asChild>
      <span>
        {label} <ExternalLinkIcon />
      </span>
    </Flex>
  </Link>
)

const FirstMessage = ({ startId }: { startId: string }) => {
  const { resource: details, errorMessage } = usePolledResource(`start-${startId}`, () => dashboardApi.readSessionStart(startId), null)
  if (errorMessage !== null) return <Text size="2" color="red">{errorMessage}</Text>
  if (details === null) return <Skeleton height="64px" />
  return (
    <Code variant="ghost" className="start-first-message">
      {details.firstMessage}
    </Code>
  )
}

const RetryButton = ({ start, onRetried }: { start: SessionStart; onRetried: () => void }) => {
  const toast = useToast()
  const [isRetrying, setIsRetrying] = useState(false)
  const retry = async (): Promise<void> => {
    setIsRetrying(true)
    try {
      const retried = await dashboardApi.retrySessionStart(start.startId)
      if (retried.state === 'failed') toast.notifyError(retried.message ?? 'The retry failed too')
      else toast.notifySuccess('Started again; the new start is at the top of the list')
      onRetried()
    } catch (retryError) {
      toast.notifyError(retryError)
    } finally {
      setIsRetrying(false)
    }
  }
  return (
    <Flex direction="column" gap="1" align="start">
      <Button onClick={() => void retry()} loading={isRetrying}>
        <ReloadIcon /> Retry
      </Button>
      <Text size="1" color="gray">
        Starts it again as a new start with the same request. Attachments are never kept, so a retry goes without them.
      </Text>
    </Flex>
  )
}

/**
 * One start from the board in full, in a drawer from the side: where it ran, its links, the first
 * message the session was sent, and for a failed one what its error means and a Retry.
 */
export const StartDetailsDrawer = ({ start, onClose, onRetried }: StartDetailsDrawerProps) => (
  <Dialog.Root open={start !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
    <Dialog.Content className="side-drawer" aria-describedby={undefined}>
      {start && (
        <Flex direction="column" gap="4">
          <Flex gap="3" align="start" justify="between">
            <Dialog.Title size="4" mb="0">
              {start.repository.name}
              {start.issueNumber === null ? '' : ` #${start.issueNumber}`} · {start.workflow}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton size="2" variant="ghost" color="gray" aria-label="Close">
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>
          {start.state === 'failed' && (
            <Callout.Root color="red" variant="surface">
              <Callout.Text weight="medium">{start.message ?? 'The start failed without a reason.'}</Callout.Text>
              {failureAdviceFor(start) && <Callout.Text>{failureAdviceFor(start)}</Callout.Text>}
            </Callout.Root>
          )}
          <DataList.Root size="2">
            <DataList.Item>
              <DataList.Label>State</DataList.Label>
              <DataList.Value>
                <Badge color={sessionStartStateColors[start.state]} radius="full">
                  {sessionStartStateLabels[start.state]}
                </Badge>
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Where</DataList.Label>
              <DataList.Value>
                {startTargetLabels[start.target].name}
                {start.runnerLabel ? ` (${start.runnerLabel})` : ''}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Agent</DataList.Label>
              <DataList.Value>{startAgentLabels[start.agent]}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Model</DataList.Label>
              <DataList.Value>
                {start.openRouterModel === null ? startModelSourceLabels[start.agent].default : `OpenRouter: ${start.openRouterModel}`}
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Started</DataList.Label>
              <DataList.Value>{new Date(start.createdAt).toLocaleString()}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label>Last change</DataList.Label>
              <DataList.Value>{new Date(start.updatedAt).toLocaleString()}</DataList.Value>
            </DataList.Item>
            {start.state !== 'failed' && start.message && (
              <DataList.Item>
                <DataList.Label>Message</DataList.Label>
                <DataList.Value>{start.message}</DataList.Value>
              </DataList.Item>
            )}
          </DataList.Root>
          <Flex direction="column" gap="2">
            {start.sessionUrl && <OutsideLink href={start.sessionUrl} label="Open the session in Claude" />}
            {subjectUrlOf(start) && <OutsideLink href={subjectUrlOf(start) ?? ''} label="Open the issue or pull request on GitHub" />}
            {start.target === 'cloud-routine' && <OutsideLink href={routinesPageUrl} label="Open the routines on claude.ai" />}
          </Flex>
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              First message sent
            </Text>
            <FirstMessage startId={start.startId} />
          </Flex>
          {start.state === 'failed' && <RetryButton start={start} onRetried={onRetried} />}
        </Flex>
      )}
    </Dialog.Content>
  </Dialog.Root>
)
