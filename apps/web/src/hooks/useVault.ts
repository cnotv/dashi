import { useCallback, useEffect, useState } from 'react'
import type { NewSecretEntry, SecretEntryChange, SecretSummary, VaultState } from '@dashi/contracts'
import { dashboardApi } from '@/lib/api'

const readVaultSnapshot = () => Promise.all([dashboardApi.readVault(), dashboardApi.listSecrets()])

/**
 * Loads the vault and its secrets, and refreshes both after every change.
 * @param onError Called when the vault cannot be read.
 * @returns The vault state, the secrets and the actions on them.
 */
export const useVault = (onError: (error: unknown) => void) => {
  const [vaultState, setVaultState] = useState<VaultState | null>(null)
  const [secrets, setSecrets] = useState<SecretSummary[]>([])

  const applySnapshot = useCallback(([nextVaultState, nextSecrets]: [VaultState, SecretSummary[]]) => {
    setVaultState(nextVaultState)
    setSecrets(nextSecrets)
  }, [])

  useEffect(() => {
    readVaultSnapshot().then(applySnapshot).catch(onError)
  }, [applySnapshot, onError])

  const runAndRefresh = async (action: () => Promise<unknown>): Promise<void> => {
    await action()
    applySnapshot(await readVaultSnapshot())
  }

  return {
    vaultState,
    secrets,
    setUp: (passphrase: string) => runAndRefresh(() => dashboardApi.setUpVault(passphrase)),
    unlock: (passphrase: string) => runAndRefresh(() => dashboardApi.unlockVault(passphrase)),
    lock: () => runAndRefresh(() => dashboardApi.lockVault()),
    addSecretEntry: (name: string, newEntry: NewSecretEntry) => runAndRefresh(() => dashboardApi.addSecretEntry(name, newEntry)),
    updateSecretEntry: (name: string, entryId: string, change: SecretEntryChange) =>
      runAndRefresh(() => dashboardApi.updateSecretEntry(name, entryId, change)),
    useSecretEntry: (name: string, entryId: string) => runAndRefresh(() => dashboardApi.useSecretEntry(name, entryId)),
    deleteSecretEntry: (name: string, entryId: string) => runAndRefresh(() => dashboardApi.deleteSecretEntry(name, entryId)),
    testSecretEntry: dashboardApi.testSecretEntry,
  }
}
