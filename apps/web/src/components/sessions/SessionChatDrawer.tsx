import { Cross2Icon, ExternalLinkIcon, GearIcon, PaperPlaneIcon } from '@radix-ui/react-icons'
import { Badge, Callout, Dialog, Flex, IconButton, Link, Skeleton, Text, TextArea, Tooltip } from '@radix-ui/themes'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ChatDelivery, ChatMessage, SessionChat } from '@dashi/contracts'
import { SourceTags } from '@/components/charts/SourceTags'
import { usePolledResource } from '@/hooks/usePolledResource'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { chatKeyOf, chatTimelineOf } from '@/lib/session-chat'
import type { ChatSubject, ChatTarget } from '@/lib/types'

interface SessionChatDrawerProps {
  subject: ChatSubject | null
  onClose: () => void
}

// Often enough to feel live while someone watches; the runner itself asks every 1.5 seconds
// while a drawer is open.
const chatPollMilliseconds = 2500
const claudeSessionsUrl = 'https://claude.ai/code'

const deliveryStateLabels: Record<ChatDelivery['state'], string> = {
  queued: 'Waiting for the laptop',
  sent: 'Sending',
  delivered: 'Delivered',
  failed: 'Not delivered',
}

const TranscriptMessage = ({ message }: { message: ChatMessage }) => {
  if (message.kind === 'tool') {
    return (
      <Flex className="chat-tool" gap="2" align="center">
        <GearIcon />
        <Text size="1" weight="medium">
          {message.toolName}
        </Text>
        <Text size="1" color="gray" className="chat-tool-summary">
          {message.text}
        </Text>
      </Flex>
    )
  }
  return (
    <Text as="div" size="2" className={message.role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble'}>
      {message.text}
    </Text>
  )
}

const PendingMessage = ({ delivery }: { delivery: ChatDelivery }) => (
  <Flex direction="column" align="end" gap="1">
    <Text as="div" size="2" className="chat-bubble chat-bubble-user chat-bubble-pending">
      {delivery.text}
    </Text>
    <Text size="1" color={delivery.state === 'failed' ? 'red' : 'gray'}>
      {deliveryStateLabels[delivery.state]}
      {delivery.message ? `: ${delivery.message}` : ''}
    </Text>
  </Flex>
)

const AvailabilityNotice = ({ chat }: { chat: SessionChat }) => {
  if (chat.availability === 'runner-offline') {
    return (
      <Callout.Root color="amber" variant="surface">
        <Callout.Text>
          The laptop runner is offline. Start it, under Credentials, to read and chat with sessions on the laptop.
        </Callout.Text>
      </Callout.Root>
    )
  }
  if (chat.availability === 'not-on-laptop') {
    return (
      <Callout.Root color="gray" variant="surface">
        <Callout.Text>
          This session is not on the laptop. Claude cloud sessions can only be read and answered in the Claude app.{' '}
          <Link href={claudeSessionsUrl} target="_blank" rel="noopener noreferrer">
            Open Claude <ExternalLinkIcon />
          </Link>
        </Callout.Text>
      </Callout.Root>
    )
  }
  if (chat.availability === 'waiting-for-runner') {
    return (
      <Flex direction="column" gap="3">
        <Text size="2" color="gray">
          Asking the laptop for this session&rsquo;s conversation&hellip;
        </Text>
        <Skeleton height="48px" />
        <Skeleton height="96px" />
      </Flex>
    )
  }
  return null
}

const ChatComposer = ({ target, sendBlocker }: { target: ChatTarget; sendBlocker: string | null }) => {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const canSend = sendBlocker === null && draft.trim() !== '' && !isSending

  const send = async (): Promise<void> => {
    if (!canSend) return
    setIsSending(true)
    try {
      await dashboardApi.sendChatMessage(target, draft.trim())
      setDraft('')
    } catch (sendError) {
      toast.notifyError(sendError)
    } finally {
      setIsSending(false)
    }
  }
  const submit = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault()
    void send()
  }
  // Enter sends and Shift+Enter starts a new line, as in Claude.
  const sendOnEnter = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (keyEvent.key !== 'Enter' || keyEvent.shiftKey || keyEvent.nativeEvent.isComposing) return
    keyEvent.preventDefault()
    void send()
  }

  return (
    <form className="chat-composer" onSubmit={submit}>
      {sendBlocker !== null && (
        <Text as="p" size="1" color="gray" mb="2">
          {sendBlocker}
        </Text>
      )}
      <Flex gap="2" align="end">
        <TextArea
          className="chat-composer-input"
          placeholder="Reply to Claude"
          aria-label="Message"
          value={draft}
          disabled={sendBlocker !== null}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          onKeyDown={sendOnEnter}
          rows={2}
        />
        <Tooltip content="Send">
          <IconButton type="submit" size="3" aria-label="Send" disabled={!canSend} loading={isSending}>
            <PaperPlaneIcon />
          </IconButton>
        </Tooltip>
      </Flex>
    </form>
  )
}

const ChatBody = ({ target }: { target: ChatTarget }) => {
  const { resource: chat, errorMessage } = usePolledResource(
    `chat-${chatKeyOf(target)}`,
    () => dashboardApi.readSessionChat(target),
    chatPollMilliseconds,
  )
  const endRef = useRef<HTMLDivElement | null>(null)
  const timeline = chat ? chatTimelineOf(chat) : []
  const lastItemKey = timeline.at(-1)?.itemKey

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lastItemKey])

  if (errorMessage !== null && chat === null) {
    return (
      <Callout.Root color="red" variant="surface">
        <Callout.Text>{errorMessage}</Callout.Text>
      </Callout.Root>
    )
  }
  if (chat === null) return <Skeleton height="120px" />

  return (
    <>
      <Flex direction="column" gap="3" className="chat-messages">
        <AvailabilityNotice chat={chat} />
        {timeline.map((item) =>
          item.source === 'transcript' ? (
            <TranscriptMessage key={item.itemKey} message={item.message} />
          ) : (
            <PendingMessage key={item.itemKey} delivery={item.delivery} />
          ),
        )}
        <div ref={endRef} />
      </Flex>
      {chat.availability === 'on-laptop' && <ChatComposer target={target} sendBlocker={chat.sendBlocker} />}
    </>
  )
}

/**
 * A session's conversation as a chat, in a drawer from the side: the transcript the laptop runner
 * reads live, and a box that sends the next message through it.
 */
export const SessionChatDrawer = ({ subject, onClose }: SessionChatDrawerProps) => (
  <Dialog.Root open={subject !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
    <Dialog.Content className="side-drawer chat-drawer" aria-describedby={undefined}>
      {subject && (
        <Flex direction="column" gap="4" className="chat-drawer-layout">
          <Flex gap="3" align="start" justify="between">
            <Flex direction="column" gap="1">
              <Dialog.Title size="4" mb="0">
                {subject.title}
              </Dialog.Title>
              <Flex gap="2" align="center">
                <Badge color={subject.badgeColor} variant="soft" radius="full">
                  {subject.badgeLabel}
                </Badge>
                <Text size="1" color="gray">
                  {subject.detail}
                </Text>
              </Flex>
              <SourceTags sourceIds={['laptop-runner']} note="The session's Claude Code transcript" />
            </Flex>
            <Dialog.Close>
              <IconButton size="2" variant="ghost" color="gray" aria-label="Close">
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <ChatBody key={chatKeyOf(subject.target)} target={subject.target} />
        </Flex>
      )}
    </Dialog.Content>
  </Dialog.Root>
)
