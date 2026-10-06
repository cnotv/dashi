import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { decryptValue, encryptValue, generateKeyMaterial } from './crypto.ts'
import { createVault } from './vault.ts'

const definitions = [
  { name: 'github-token', label: 'GitHub token', description: '', tokenPageUrl: 'https://github.com/settings/tokens' },
  { name: 'openrouter-api-key', label: 'OpenRouter', description: '', tokenPageUrl: 'https://openrouter.ai/settings/keys' },
]
const sampleToken = 'ghp_exampleTokenValue1234567890abcd'
const strongPassphrase = 'correct horse battery staple'

const createDatabaseFile = (): { database: DatabaseSync; filePath: string } => {
  const filePath = join(mkdtempSync(join(tmpdir(), 'vault-test-')), 'dashboard.sqlite')
  return { database: new DatabaseSync(filePath), filePath }
}

describe('crypto', () => {
  it('round-trips a value', () => {
    const key = generateKeyMaterial()
    expect(decryptValue(key, encryptValue(key, sampleToken, 'github-token'), 'github-token')).toBe(sampleToken)
  })

  it('uses a fresh initialization vector every time', () => {
    const key = generateKeyMaterial()
    expect(encryptValue(key, sampleToken, 'a').ciphertext).not.toBe(encryptValue(key, sampleToken, 'a').ciphertext)
  })

  it('rejects a tampered ciphertext', () => {
    const key = generateKeyMaterial()
    const encryptedValue = encryptValue(key, sampleToken, 'github-token')
    const tamperedBytes = Buffer.from(encryptedValue.ciphertext, 'base64').map((byte, index) => (index === 0 ? byte ^ 1 : byte))
    expect(() => decryptValue(key, { ...encryptedValue, ciphertext: Buffer.from(tamperedBytes).toString('base64') }, 'github-token')).toThrow()
  })

  it('rejects a tampered tag or initialization vector', () => {
    const key = generateKeyMaterial()
    const encryptedValue = encryptValue(key, sampleToken, 'github-token')
    const otherValue = encryptValue(key, sampleToken, 'github-token')
    expect(() => decryptValue(key, { ...encryptedValue, authenticationTag: otherValue.authenticationTag }, 'github-token')).toThrow()
    expect(() => decryptValue(key, { ...encryptedValue, initializationVector: otherValue.initializationVector }, 'github-token')).toThrow()
  })

  it('rejects a ciphertext moved to another secret name', () => {
    const key = generateKeyMaterial()
    expect(() => decryptValue(key, encryptValue(key, sampleToken, 'github-token'), 'openrouter-api-key')).toThrow()
  })

  it('rejects the wrong key', () => {
    expect(() => decryptValue(generateKeyMaterial(), encryptValue(generateKeyMaterial(), sampleToken, 'a'), 'a')).toThrow()
  })
})

describe('environment vault', () => {
  it('stores and reads a secret without keeping plaintext in the database file', () => {
    const { database, filePath } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.saveSecret('github-token', sampleToken)
    expect(vault.readSecretValue('github-token')).toBe(sampleToken)
    database.close()
    expect(readFileSync(filePath).includes(Buffer.from(sampleToken))).toBe(false)
  })

  it('summarises secrets with only the last four characters', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.saveSecret('github-token', sampleToken)
    expect(vault.listSecrets(definitions)).toEqual([
      expect.objectContaining({
        name: 'github-token',
        entries: [expect.objectContaining({ entryId: 'default', label: 'Default', lastFour: 'abcd', isInUse: true })],
      }),
      expect.objectContaining({ name: 'openrouter-api-key', entries: [] }),
    ])
    expect(JSON.stringify(vault.listSecrets(definitions))).not.toContain(sampleToken)
  })

  it('adds the label column to a vault made before tokens had names', () => {
    const { database } = createDatabaseFile()
    database.exec(`CREATE TABLE secrets (
      name TEXT PRIMARY KEY, last_four TEXT NOT NULL, ciphertext TEXT NOT NULL, initialization_vector TEXT NOT NULL,
      authentication_tag TEXT NOT NULL, key_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.saveSecret('github-token', sampleToken)
    expect(vault.listSecrets(definitions)[0]?.entries).toEqual([expect.objectContaining({ label: 'Default', isInUse: true })])
  })

  it('keeps several tokens per credential and reads the one in use', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    const personalId = vault.addSecretEntry('github-token', 'Personal', 'ghp_personalToken0001')
    const workId = vault.addSecretEntry('github-token', 'Work', 'ghp_workToken0002')
    expect(personalId).toBe('default')
    expect(vault.readSecretValue('github-token')).toBe('ghp_personalToken0001')
    vault.useSecretEntry('github-token', workId)
    expect(vault.readSecretValue('github-token')).toBe('ghp_workToken0002')
    expect(vault.listSecrets(definitions)[0]?.entries.map((entry) => [entry.label, entry.isInUse])).toEqual([
      ['Personal', false],
      ['Work', true],
    ])
    expect(vault.readAllSecretValues().toSorted()).toEqual(['ghp_personalToken0001', 'ghp_workToken0002'])
  })

  it('renames and replaces a token, and hands "in use" to the oldest when the one in use is removed', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.addSecretEntry('github-token', 'Personal', 'ghp_personalToken0001')
    const workId = vault.addSecretEntry('github-token', 'Work', 'ghp_workToken0002')
    vault.useSecretEntry('github-token', workId)
    vault.updateSecretEntry('github-token', workId, { label: 'Client', value: 'ghp_clientToken0003' })
    expect(vault.readSecretValue('github-token')).toBe('ghp_clientToken0003')
    expect(vault.listSecrets(definitions)[0]?.entries[1]).toEqual(expect.objectContaining({ label: 'Client', lastFour: '0003' }))
    vault.deleteSecretEntry('github-token', workId)
    expect(vault.readSecretValue('github-token')).toBe('ghp_personalToken0001')
    expect(() => vault.useSecretEntry('github-token', workId)).toThrow('Unknown token')
  })

  it('keeps every token readable after the key is rotated', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.addSecretEntry('github-token', 'Personal', 'ghp_personalToken0001')
    const workId = vault.addSecretEntry('github-token', 'Work', 'ghp_workToken0002')
    vault.rotate(generateKeyMaterial().toString('base64'))
    expect(vault.readSecretEntryValue('github-token', workId)).toBe('ghp_workToken0002')
    expect(vault.readSecretValue('github-token')).toBe('ghp_personalToken0001')
  })

  it('stays locked when restarted with a different key', () => {
    const { database } = createDatabaseFile()
    createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() }).saveSecret('github-token', sampleToken)
    const restartedVault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    expect(restartedVault.readState()).toEqual({ mode: 'environment', initialised: true, unlocked: false })
    expect(() => restartedVault.readSecretValue('github-token')).toThrow('locked')
  })

  it('rotates every secret to a new key', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'environment', environmentKey: generateKeyMaterial() })
    vault.saveSecret('github-token', sampleToken)
    const nextKey = generateKeyMaterial()
    vault.rotate(nextKey.toString('base64'))
    const restartedVault = createVault(database, { mode: 'environment', environmentKey: nextKey })
    expect(restartedVault.readSecretValue('github-token')).toBe(sampleToken)
  })
})

describe('passphrase vault', () => {
  it('starts locked and uninitialised, then unlocks with the right passphrase only', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'passphrase', environmentKey: null })
    expect(vault.readState()).toEqual({ mode: 'passphrase', initialised: false, unlocked: false })
    vault.initialise(strongPassphrase)
    vault.saveSecret('github-token', sampleToken)
    vault.lock()
    expect(() => vault.readSecretValue('github-token')).toThrow('locked')
    expect(() => vault.unlock('wrong passphrase entirely')).toThrow('Wrong passphrase')
    vault.unlock(strongPassphrase)
    expect(vault.readSecretValue('github-token')).toBe(sampleToken)
  })

  it('refuses a short passphrase', () => {
    const { database } = createDatabaseFile()
    expect(() => createVault(database, { mode: 'passphrase', environmentKey: null }).initialise('short')).toThrow('at least')
  })

  it('keeps the key only in memory across a restart', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'passphrase', environmentKey: null })
    vault.initialise(strongPassphrase)
    vault.saveSecret('github-token', sampleToken)
    const restartedVault = createVault(database, { mode: 'passphrase', environmentKey: null })
    expect(restartedVault.readState().unlocked).toBe(false)
    restartedVault.unlock(strongPassphrase)
    expect(restartedVault.readSecretValue('github-token')).toBe(sampleToken)
  })

  it('rotates to a new passphrase', () => {
    const { database } = createDatabaseFile()
    const vault = createVault(database, { mode: 'passphrase', environmentKey: null })
    vault.initialise(strongPassphrase)
    vault.saveSecret('github-token', sampleToken)
    vault.rotate('an entirely different passphrase')
    const restartedVault = createVault(database, { mode: 'passphrase', environmentKey: null })
    expect(() => restartedVault.unlock(strongPassphrase)).toThrow('Wrong passphrase')
    restartedVault.unlock('an entirely different passphrase')
    expect(restartedVault.readSecretValue('github-token')).toBe(sampleToken)
  })
})
