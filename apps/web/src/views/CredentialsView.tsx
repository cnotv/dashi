import { Badge, Card, Flex, Table, Text } from '@radix-ui/themes'
import type { SecretEntrySummary, SecretSummary } from '@dashi/contracts'
import { ConnectAgentsPanel } from '@/components/credentials/ConnectAgentsPanel'
import { CredentialGuideDialog } from '@/components/credentials/CredentialGuideDialog'
import { CredentialTokens } from '@/components/credentials/CredentialTokens'
import { MachineSetupPanel } from '@/components/credentials/MachineSetupPanel'
import { RoutinePanel } from '@/components/credentials/RoutinePanel'
import { RunnerPanel } from '@/components/credentials/RunnerPanel'
import { VaultPanel } from '@/components/credentials/VaultPanel'
import { useToast } from '@/hooks/useToast'
import { useVault } from '@/hooks/useVault'
import { credentialGuides } from '@/lib/credential-guides'
import type { CredentialGuide } from '@/lib/types'

const guideOf = (secret: SecretSummary): CredentialGuide | undefined => credentialGuides[secret.name]

const GuideButtonOf = ({ secret }: { secret: SecretSummary }) => {
  const guide = guideOf(secret)
  return guide === undefined ? null : <CredentialGuideDialog label={secret.label} guide={guide} />
}

/**
 * The Credentials page: the vault and the stored credentials. A credential can hold several
 * named tokens; the selected one is the one the dashboard reads.
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
      {vault.vaultState && (
        <VaultPanel vaultState={vault.vaultState} onSetUp={vault.setUp} onUnlock={vault.unlock} onLock={vault.lock} />
      )}

      <Card size="1">
        <Text as="p" size="2" color="gray" mx="3" mt="2">
          Each credential can hold several tokens. Dashi uses the selected one: select another to switch, or add a token and tick
          Use this token now.
        </Text>
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
                  <Flex direction="column" gap="2" align="start">
                    <Flex gap="2" align="center" wrap="wrap">
                      <Text size="2" weight="medium">
                        {secret.label}
                      </Text>
                      <GuideButtonOf secret={secret} />
                      {guideOf(secret)?.isUsedByDashi === false && (
                        <Badge color="gray" variant="soft" radius="full">
                          Not used yet
                        </Badge>
                      )}
                    </Flex>
                    <Text as="div" size="1" color="gray">
                      {secret.description}
                    </Text>
                  </Flex>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <CredentialTokens
                    secret={secret}
                    isUnlocked={isUnlocked}
                    onAdd={(newEntry) => vault.addSecretEntry(secret.name, newEntry)}
                    onUpdate={(entryId, change) => vault.updateSecretEntry(secret.name, entryId, change)}
                    onUse={(entry) => void run(() => vault.useSecretEntry(secret.name, entry.entryId), `${secret.label}: Dashi now uses ${entry.label}`)}
                    onTest={(entry) => void testEntry(secret, entry)}
                    onRemove={(entry) => void run(() => vault.deleteSecretEntry(secret.name, entry.entryId), `${secret.label}: ${entry.label} removed`)}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card>

      <MachineSetupPanel />
      <ConnectAgentsPanel />
      <RunnerPanel />
      <RoutinePanel />
    </Flex>
  )
}
