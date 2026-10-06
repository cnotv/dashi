import { ExternalLinkIcon } from '@radix-ui/react-icons'
import { Button, Dialog, Flex, Link, Text, TextField } from '@radix-ui/themes'
import { useState, type FormEvent } from 'react'
import type { SecretEntrySummary, SecretSummary } from '@dashi/contracts'
import { useToast } from '@/hooks/useToast'

interface SecretDialogProps {
  secret: SecretSummary
  // The token to rename or replace, or null to add one.
  entry: SecretEntrySummary | null
  disabled: boolean
  onSave: (label: string, value: string) => Promise<void>
}

/**
 * The dialog that adds a token to a credential, or renames or replaces one; the value is cleared
 * as soon as it is sent, and left empty when editing keeps the stored one.
 */
export const SecretDialog = ({ secret, entry, disabled, onSave }: SecretDialogProps) => {
  const toast = useToast()
  const isAdding = entry === null
  const [isOpen, setIsOpen] = useState(false)
  const [tokenLabel, setTokenLabel] = useState('')
  const [secretValue, setSecretValue] = useState('')

  const open = (nextOpen: boolean): void => {
    setIsOpen(nextOpen)
    setTokenLabel(entry?.label ?? (secret.entries.length === 0 ? 'Default' : ''))
    setSecretValue('')
  }

  const save = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault()
    try {
      await onSave(tokenLabel, secretValue)
      toast.notifySuccess(`${secret.label} ${isAdding ? 'added' : 'saved'}`)
      setIsOpen(false)
    } catch (saveError) {
      toast.notifyError(saveError)
    } finally {
      setSecretValue('')
    }
  }

  const isFirstToken = isAdding && secret.entries.length === 0
  const triggerLabel = isAdding ? (isFirstToken ? 'Add' : 'Add another') : 'Edit'

  return (
    <Dialog.Root open={isOpen} onOpenChange={open}>
      <Dialog.Trigger>
        <Button size="1" variant={isFirstToken ? 'solid' : 'soft'} color={isFirstToken ? undefined : 'gray'} disabled={disabled}>
          {triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>{entry === null ? `New ${secret.label}` : `${secret.label}: ${entry.label}`}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="2">
          {secret.description} The value is encrypted on the server and never shown again.
        </Dialog.Description>
        <Link href={secret.tokenPageUrl} target="_blank" rel="noopener noreferrer" size="2">
          <Flex gap="1" align="center" mb="4" asChild>
            <span>
              Create one on {new URL(secret.tokenPageUrl).hostname} <ExternalLinkIcon />
            </span>
          </Flex>
        </Link>
        <form onSubmit={(submitEvent) => void save(submitEvent)}>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                Name
              </Text>
              <TextField.Root
                maxLength={60}
                placeholder="Work"
                autoFocus={isAdding}
                value={tokenLabel}
                onChange={(changeEvent) => setTokenLabel(changeEvent.target.value)}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                {isAdding ? 'Value' : 'New value, or empty to keep the stored one'}
              </Text>
              <TextField.Root
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus={!isAdding}
                value={secretValue}
                onChange={(changeEvent) => setSecretValue(changeEvent.target.value)}
              />
            </label>
          </Flex>
          <Flex gap="3" mt="5" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={isAdding && secretValue.trim().length === 0}>
              Save
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
