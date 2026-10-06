import type { SecretDefinition, SecretSummary, SecretTestResult, VaultMode, VaultState } from '@dashi/contracts'

export interface EncryptedValue {
  ciphertext: string
  initializationVector: string
  authenticationTag: string
}

export interface StoredSecretRow extends EncryptedValue {
  name: string
  label: string | null
  lastFour: string
  keyVersion: number
  createdAt: string
  updatedAt: string
}

export type CredentialHeader = 'bearer' | 'x-api-key'

export interface SecretTester {
  url: string
  credentialHeader: CredentialHeader
  extraHeaders: Record<string, string>
}

export interface SecretDefinitionWithTester extends SecretDefinition {
  tester: SecretTester | null
}

export interface VaultOptions {
  mode: VaultMode
  environmentKey: Buffer | null
}

export interface Vault {
  readState: () => VaultState
  initialise: (passphrase: string) => void
  unlock: (passphrase: string) => void
  lock: () => void
  rotate: (nextKeyMaterial: string) => void
  listSecrets: (definitions: SecretDefinition[]) => SecretSummary[]
  saveSecret: (name: string, value: string) => void
  deleteSecret: (name: string) => void
  readSecretValue: (name: string) => string | null
  addSecretEntry: (name: string, label: string, value: string) => string
  updateSecretEntry: (name: string, entryId: string, change: { label?: string; value?: string }) => void
  useSecretEntry: (name: string, entryId: string) => void
  deleteSecretEntry: (name: string, entryId: string) => void
  readSecretEntryValue: (name: string, entryId: string) => string | null
  readAllSecretValues: () => string[]
}

export type SecretTestRunner = (definition: SecretDefinitionWithTester, value: string) => Promise<SecretTestResult>
