import { Cross2Icon, FileIcon, FilePlusIcon, PaperPlaneIcon, PlusIcon } from '@radix-ui/react-icons'
import { Badge, Button, Callout, Dialog, Flex, IconButton, Link, Select, Text, TextArea, Tooltip } from '@radix-ui/themes'
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { CreatedIssue, RepositoryReference, SessionStart } from '@dashi/contracts'
import { useRepositories } from '@/hooks/useBoard'
import { useStartChoices } from '@/hooks/useSessionStarts'
import { useToast } from '@/hooks/useToast'
import { dashboardApi } from '@/lib/api'
import { readAttachment } from '@/lib/attachments'
import { issueBodyFor, issueTitleFrom } from '@/lib/new-issue'
import { errorMessageOf, parseRepositoryKey, repositoryKey } from '@/lib/presentation'
import { openRouterModelFor } from '@/lib/start-session'
import type { PickedAttachment } from '@/lib/types'
import { StartChoicesFields } from './StartChoicesFields'
import { StartedSummary } from './StartedSummary'

interface NewIssueDialogProps {
  defaultRepository: RepositoryReference | null
}

const kilobytesOf = (byteSize: number): string => `${Math.max(1, Math.round(byteSize / 1024))} KB`

const AttachmentList = ({ pickedAttachments, onRemove }: { pickedAttachments: PickedAttachment[]; onRemove: (name: string) => void }) => (
  <Flex gap="2" wrap="wrap">
    {pickedAttachments.map(({ attachment, byteSize }) => (
      <Badge key={attachment.name} color="gray" variant="soft" size="2">
        <FileIcon />
        {attachment.name} · {kilobytesOf(byteSize)}
        <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.name)}>
          <Cross2Icon />
        </IconButton>
      </Badge>
    ))}
  </Flex>
)

/**
 * The New issue button and its dialog: a chat to write what the work is about, with files
 * attached by picking, pasting or dropping them, and where to develop it. Sending opens the issue
 * on GitHub, titled by the message's first line, and starts a session on it with the message and
 * the attachments, which go to the session only and are never stored.
 */
export const NewIssueDialog = ({ defaultRepository }: NewIssueDialogProps) => {
  const toast = useToast()
  const { repositories } = useRepositories()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [chosenRepositoryKey, setChosenRepositoryKey] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [pickedAttachments, setPickedAttachments] = useState<PickedAttachment[]>([])
  const [createdIssue, setCreatedIssue] = useState<CreatedIssue | null>(null)
  const [started, setStarted] = useState<SessionStart | null>(null)

  const fallbackRepository = defaultRepository ?? repositories[0] ?? null
  const repositoryKeyShown = chosenRepositoryKey ?? (fallbackRepository ? repositoryKey(fallbackRepository) : '')
  const repository = useMemo(() => parseRepositoryKey(repositoryKeyShown), [repositoryKeyShown])
  const attachmentBytes = pickedAttachments.reduce((total, picked) => total + picked.byteSize, 0)
  const { choices, setChoices, options, errorMessage, chosenTarget, chosenAvailability, modelProblem } = useStartChoices(
    repository ?? { owner: '', name: '' },
    isOpen && repository !== null,
    'feature',
    attachmentBytes,
  )
  const attachmentCountLimit = options?.attachmentLimits.fileCount ?? 0
  const title = issueTitleFrom(text)
  const canSubmit = repository !== null && title !== '' && chosenTarget !== null && chosenAvailability?.isAvailable === true && modelProblem === null && !isSubmitting

  const resetForm = (): void => {
    setText('')
    setPickedAttachments([])
    setCreatedIssue(null)
    setStarted(null)
  }

  const changeOpen = (nextOpen: boolean): void => {
    setIsOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  const addFiles = async (files: File[]): Promise<void> => {
    const roomLeft = attachmentCountLimit - pickedAttachments.length
    if (files.length > roomLeft) toast.notifyError(`Attach at most ${attachmentCountLimit} files`)
    try {
      const added = await files.slice(0, Math.max(0, roomLeft)).reduce<Promise<PickedAttachment[]>>(async (pickedSoFar, file) => {
        const earlier = await pickedSoFar
        const takenNames = [...pickedAttachments, ...earlier].map((picked) => picked.attachment.name)
        return [...earlier, await readAttachment(file, takenNames)]
      }, Promise.resolve([]))
      setPickedAttachments((current) => [...current, ...added])
    } catch (readError) {
      toast.notifyError(readError)
    }
  }

  // A screenshot pasted into the text becomes an attachment, as it would in Claude.
  const attachPastedFiles = (pasteEvent: ClipboardEvent<HTMLTextAreaElement>): void => {
    const pastedFiles = Array.from(pasteEvent.clipboardData.files)
    if (pastedFiles.length === 0) return
    pasteEvent.preventDefault()
    void addFiles(pastedFiles)
  }

  const attachDroppedFiles = (dropEvent: DragEvent<HTMLFormElement>): void => {
    dropEvent.preventDefault()
    setIsDraggingFiles(false)
    if (createdIssue === null) void addFiles(Array.from(dropEvent.dataTransfer.files))
  }

  const showDropTarget = (dragEvent: DragEvent<HTMLFormElement>): void => {
    if (!dragEvent.dataTransfer.types.includes('Files')) return
    dragEvent.preventDefault()
    setIsDraggingFiles(true)
  }

  const startOn = async (issue: CreatedIssue, chosenRepository: RepositoryReference): Promise<void> => {
    if (chosenTarget === null) return
    try {
      const sessionStart = await dashboardApi.startSession({
        repository: chosenRepository,
        issueNumber: issue.number,
        pullRequestNumber: null,
        workflow: choices.workflow,
        target: chosenTarget,
        permissionMode: choices.permissionMode,
        openRouterModel: openRouterModelFor(choices, chosenTarget),
        note: text.trim(),
        attachments: pickedAttachments.map((picked) => picked.attachment),
      })
      if (sessionStart.state === 'failed') toast.notifyError(sessionStart.message ?? 'The session did not start')
      setStarted(sessionStart)
    } catch (startError) {
      toast.notifyError(`Issue #${issue.number} is open, but the session did not start: ${errorMessageOf(startError)}`)
    }
  }

  const send = async (): Promise<void> => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const issue =
        createdIssue ??
        (await dashboardApi.createIssue(repository, {
          title,
          body: issueBodyFor(text.trim(), pickedAttachments.map((picked) => picked.attachment.name)),
        }))
      setCreatedIssue(issue)
      await startOn(issue, repository)
    } catch (createError) {
      toast.notifyError(createError)
    } finally {
      setIsSubmitting(false)
    }
  }

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault()
    void send()
  }

  // Enter sends and Shift+Enter starts a new line, as in the session chat.
  const sendOnEnter = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (keyEvent.key !== 'Enter' || keyEvent.shiftKey || keyEvent.nativeEvent.isComposing) return
    keyEvent.preventDefault()
    void send()
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={changeOpen}>
      <Dialog.Trigger>
        <Button aria-label="New issue">
          <PlusIcon /> New issue
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>New issue</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Say what the work is about. Sending opens the issue on GitHub and starts a session on it.
        </Dialog.Description>
        {started && createdIssue ? (
          <Flex direction="column" gap="4">
            <Link href={createdIssue.url} target="_blank" rel="noopener noreferrer" size="2">
              Issue #{createdIssue.number} is open on GitHub
            </Link>
            <StartedSummary start={started} />
            <Flex justify="end">
              <Dialog.Close>
                <Button>Done</Button>
              </Dialog.Close>
            </Flex>
          </Flex>
        ) : (
          <form onSubmit={submit} onDragOver={showDropTarget} onDragLeave={() => setIsDraggingFiles(false)} onDrop={attachDroppedFiles}>
            <Flex direction="column" gap="4">
              {createdIssue && (
                <Callout.Root color="amber" size="1">
                  <Callout.Text>
                    Issue{' '}
                    <Link href={createdIssue.url} target="_blank" rel="noopener noreferrer">
                      #{createdIssue.number}
                    </Link>{' '}
                    is open; pick where to run it and send again, or start it later from its card.
                  </Callout.Text>
                </Callout.Root>
              )}
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Repository
                </Text>
                <Select.Root value={repositoryKeyShown} onValueChange={setChosenRepositoryKey} disabled={createdIssue !== null}>
                  <Select.Trigger placeholder="Choose a repository" aria-label="Repository" />
                  <Select.Content>
                    {repositories.map((listedRepository) => (
                      <Select.Item key={repositoryKey(listedRepository)} value={repositoryKey(listedRepository)}>
                        {repositoryKey(listedRepository)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <StartChoicesFields
                choices={choices}
                onChange={setChoices}
                options={options}
                optionsError={errorMessage}
                chosenTarget={chosenTarget}
                chosenAvailability={chosenAvailability}
                attachmentBytes={attachmentBytes}
                modelProblem={modelProblem}
                showsWorkflow
              />
              <Flex direction="column" gap="2" className={isDraggingFiles ? 'new-issue-composer new-issue-composer-dropping' : 'new-issue-composer'}>
                {pickedAttachments.length > 0 && (
                  <AttachmentList
                    pickedAttachments={pickedAttachments}
                    onRemove={(name) => setPickedAttachments((current) => current.filter((picked) => picked.attachment.name !== name))}
                  />
                )}
                <Flex gap="2" align="end">
                  <Tooltip content="Attach files">
                    <IconButton
                      type="button"
                      size="3"
                      variant="soft"
                      color="gray"
                      aria-label="Attach files"
                      disabled={createdIssue !== null || pickedAttachments.length >= attachmentCountLimit}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FilePlusIcon />
                    </IconButton>
                  </Tooltip>
                  <TextArea
                    className="chat-composer-input"
                    rows={3}
                    maxLength={20000}
                    placeholder="What should it do? The first line becomes the issue title. Drop or paste files to attach them."
                    aria-label="Message"
                    value={text}
                    disabled={createdIssue !== null}
                    onChange={(changeEvent) => setText(changeEvent.target.value)}
                    onKeyDown={sendOnEnter}
                    onPaste={attachPastedFiles}
                  />
                  <Tooltip content={createdIssue ? 'Start the session' : 'Open the issue and start'}>
                    <IconButton type="submit" size="3" aria-label="Send" loading={isSubmitting} disabled={!canSubmit}>
                      <PaperPlaneIcon />
                    </IconButton>
                  </Tooltip>
                </Flex>
                <Text size="1" color="gray">
                  {title === '' ? 'Attachments go to the session only and are never stored.' : `Issue title: ${title}`}
                </Text>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  aria-label="Attachments"
                  onChange={(changeEvent) => {
                    void addFiles(Array.from(changeEvent.target.files ?? []))
                    changeEvent.target.value = ''
                  }}
                />
              </Flex>
            </Flex>
          </form>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}
