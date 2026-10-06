import { Badge, Button, Card, Code, Flex, Table, Text } from '@radix-ui/themes'
import type { SecretEntrySummary, SecretSummary } from '@dashi/contracts'
import { ConnectAgentsPanel } from '@/components/credentials/ConnectAgentsPanel'
import { MachineSetupPanel } from '@/components/credentials/MachineSetupPanel'
import { RoutinePanel } from '@/components/credentials/RoutinePanel'
import { RunnerPanel } from '@/components/credentials/RunnerPanel'
import { SecretDialog } from '@/components/credentials/SecretDialog'
import { VaultPanel } from '@/components/credentials/VaultPanel'
import { useToast } from '@/hooks/useToast'
import { useVault } from '@/hooks/useVault'

/**
 * The Credentials page: the vault and the stored credentials. A credential can hold several
 * tokens, each with a name; the one marked In use is the one the dashboard reads, and Use this
 * moves the mark.
 */
export const CredentialsView = () => {
  const toast = useToast()
  const vault = useVault(toast.notifyError)
  const isUnlocked = vault.vaultState?.unlocked ?? false

  const run = async (action: () => Promise<void>, doneMessage: string): Promise<void> => {
    try {
      await action()
      toast.notifySuccess(doneMessage)
    } catch (actionError) {
      toast.notifyError(actionError)
    }
  }

  const testEntry = async (secret: SecretSummary, entry: SecretEntrySummary): Promise<void> => {
    try {
      const testResult = await vault.testSecretEntry(secret.name, entry.entryId)
      const statusSuffix = testResult.status ? ` (${testResult.status})` : ''
      if (testResult.ok) toast.notifySuccess(`${secret.label}, ${entry.label}: ${testResult.message}`)
      else toast.notifyError(`${secret.label}, ${entry.label}: ${testResult.message}${statusSuffix}`)
    } catch (testError) {
      toast.notifyError(testError)
    }
  }

  return (
    <Flex direction="column" gap="5" maxWidth="1000px">
      <MachineSetupPanel />
      {vault.vaultState && (
        <VaultPanel vaultState={vault.vaultState} onSetUp={vault.setUp} onUnlock={vault.unlock} onLock={vault.lock} />
      )}

      <Card size="1">
        <Table.Root variant="ghost" size="2">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell width="40%">Credential</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Tokens</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {vault.secrets.map((secret) => (
              <Table.Row key={secret.name}>
                <Table.RowHeaderCell>
                  <Text as="div" size="2" weight="medium">
                    {secret.label}
                  </Text>
                  <Text as="div" size="1" color="gray">
                    {secret.description}
                  </Text>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Flex direction="column" gap="2" align="start">
                    {secret.entries.length === 0 && (
                      <Badge variant="outline" color="gray" radius="full">
                        Not set
                      </Badge>
                    )}
                    {secret.entries.map((entry) => (
                      <Flex key={entry.entryId} gap="2" align="center" wrap="wrap">
                        <Text size="2" weight="medium">
                          {entry.label}
                        </Text>
                        <Code variant="soft" color="gray">
                          ••••{entry.lastFour}
                        </Code>
                        {entry.isInUse ? (
                          <Badge color="green" radius="full">
                            In use
                          </Badge>
                        ) : (
                          <Button
                            size="1"
                            variant="soft"
                            disabled={!isUnlocked}
                            onClick={() =>
                              void run(() => vault.useSecretEntry(secret.name, entry.entryId), `${secret.label}: now using ${entry.label}`)
                            }
                          >
                            Use this
                          </Button>
                        )}
                        <SecretDialog
                          secret={secret}
                          entry={entry}
                          disabled={!isUnlocked}
                          onSave={(label, value) =>
                            vault.updateSecretEntry(secret.name, entry.entryId, value.trim() === '' ? { label } : { label, value })
                          }
                        />
                        <Button size="1" variant="soft" color="gray" disabled={!isUnlocked} onClick={() => void testEntry(secret, entry)}>
                          Test
                        </Button>
                        <Button
                          size="1"
                          variant="ghost"
                          color="red"
                          onClick={() => void run(() => vault.deleteSecretEntry(secret.name, entry.entryId), `${secret.label}: ${entry.label} removed`)}
                        >
                          Remove
                        </Button>
                      </Flex>
                    ))}
                    <SecretDialog
                      secret={secret}
                      entry={null}
                      disabled={!isUnlocked}
                      onSave={(label, value) => vault.addSecretEntry(secret.name, label, value)}
                    />
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card>

      <ConnectAgentsPanel />
      <RunnerPanel />
      <RoutinePanel />
    </Flex>
  )
}
