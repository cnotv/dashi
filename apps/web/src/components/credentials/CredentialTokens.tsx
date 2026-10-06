import { Badge, Button, Code, Flex, RadioGroup, Text } from '@radix-ui/themes'
import type { NewSecretEntry, SecretEntryChange, SecretEntrySummary, SecretSummary } from '@dashi/contracts'
import { SecretDialog } from '@/components/credentials/SecretDialog'

interface CredentialTokensProps {
  secret: SecretSummary
  isUnlocked: boolean
  onAdd: (newEntry: NewSecretEntry) => Promise<void>
  onUpdate: (entryId: string, change: SecretEntryChange) => Promise<void>
  onUse: (entry: SecretEntrySummary) => void
  onTest: (entry: SecretEntrySummary) => void
  onRemove: (entry: SecretEntrySummary) => void
}

/**
 * One credential's tokens as a radio group: the selected token is the one Dashi uses, and
 * selecting another switches to it. Each token can be edited, tested or removed, and Add token
 * adds one.
 */
export const CredentialTokens = ({ secret, isUnlocked, onAdd, onUpdate, onUse, onTest, onRemove }: CredentialTokensProps) => {
  const inUseEntry = secret.entries.find((entry) => entry.isInUse)

  const useEntryWithId = (entryId: string): void => {
    const chosenEntry = secret.entries.find((entry) => entry.entryId === entryId)
    if (chosenEntry !== undefined) onUse(chosenEntry)
  }

  return (
    <Flex direction="column" gap="2" align="start">
      {secret.entries.length === 0 ? (
        <Badge variant="outline" color="gray" radius="full">
          Not set
        </Badge>
      ) : (
        <RadioGroup.Root
          size="2"
          value={inUseEntry?.entryId ?? ''}
          onValueChange={useEntryWithId}
          disabled={!isUnlocked}
          aria-label={`${secret.label}: the token Dashi uses`}
        >
          {secret.entries.map((entry) => (
            <Flex key={entry.entryId} gap="3" align="center" wrap="wrap">
              <RadioGroup.Item value={entry.entryId}>
                <Flex gap="2" align="center">
                  <Text size="2" weight="medium">
                    {entry.label}
                  </Text>
                  <Code variant="soft" color="gray">
                    ••••{entry.lastFour}
                  </Code>
                  {entry.isInUse && (
                    <Badge color="green" radius="full">
                      In use
                    </Badge>
                  )}
                </Flex>
              </RadioGroup.Item>
              <Flex gap="1" align="center">
                <SecretDialog
                  secret={secret}
                  entry={entry}
                  disabled={!isUnlocked}
                  onSave={({ label, value }) => onUpdate(entry.entryId, value.trim() === '' ? { label } : { label, value })}
                />
                <Button size="1" variant="soft" color="gray" disabled={!isUnlocked} onClick={() => onTest(entry)}>
                  Test
                </Button>
                <Button size="1" variant="ghost" color="red" onClick={() => onRemove(entry)}>
                  Remove
                </Button>
              </Flex>
            </Flex>
          ))}
        </RadioGroup.Root>
      )}
      <SecretDialog secret={secret} entry={null} disabled={!isUnlocked} onSave={onAdd} />
    </Flex>
  )
}
