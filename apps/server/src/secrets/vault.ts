import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SecretDefinition, SecretEntrySummary, SecretSummary, VaultState } from '@dashi/contracts'
import {
  decryptValue,
  deriveKeyFromPassphrase,
  encryptValue,
  generateSalt,
  lastFourCharacters,
  parseEncodedKey,
} from './crypto.ts'
import type { EncryptedValue, StoredSecretRow, Vault, VaultOptions } from './types.ts'

// Every existing vault was sealed with this text, so it keeps the app's name from before Dashi.
const verifierPlaintext = 'agent-dashboard-vault-verifier'
const verifierAssociatedData = 'vault-verifier'
const minimumPassphraseLength = 12
// A credential's first token is stored under the credential's own name, as every token was before
// a credential could hold several; later ones get a suffix after this separator.
const entrySeparator = '#'
const firstEntryId = 'default'
const firstEntryLabel = 'Default'

const createSchema = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vault_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS secrets (
      name TEXT PRIMARY KEY,
      last_four TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      initialization_vector TEXT NOT NULL,
      authentication_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  const columnNames = database
    .prepare('PRAGMA table_info(secrets)')
    .all()
    .map((column) => String(column.name))
  if (!columnNames.includes('label')) database.exec('ALTER TABLE secrets ADD COLUMN label TEXT')
}

const rowNameOf = (name: string, entryId: string): string => (entryId === firstEntryId ? name : `${name}${entrySeparator}${entryId}`)

const entryIdOf = (name: string, rowName: string): string | null => {
  if (rowName === name) return firstEntryId
  return rowName.startsWith(`${name}${entrySeparator}`) ? rowName.slice(name.length + entrySeparator.length) : null
}

const inUseMetaKey = (name: string): string => `in-use:${name}`

const readMeta = (database: DatabaseSync, key: string): string | null => {
  const metaRow = database.prepare('SELECT value FROM vault_meta WHERE key = ?').get(key)
  return typeof metaRow?.value === 'string' ? metaRow.value : null
}

const writeMeta = (database: DatabaseSync, key: string, value: string): void => {
  database
    .prepare('INSERT INTO vault_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

const readVerifier = (database: DatabaseSync): EncryptedValue | null => {
  const encodedVerifier = readMeta(database, 'verifier')
  return encodedVerifier === null ? null : (JSON.parse(encodedVerifier) as EncryptedValue)
}

const keyMatchesVerifier = (key: Buffer, verifier: EncryptedValue): boolean => {
  try {
    return decryptValue(key, verifier, verifierAssociatedData) === verifierPlaintext
  } catch {
    return false
  }
}

const writeVerifierForKey = (database: DatabaseSync, key: Buffer): void => {
  writeMeta(database, 'verifier', JSON.stringify(encryptValue(key, verifierPlaintext, verifierAssociatedData)))
}

const readKeyVersion = (database: DatabaseSync): number => Number(readMeta(database, 'key_version') ?? '1')

const readSecretRows = (database: DatabaseSync): StoredSecretRow[] =>
  database
    .prepare(
      `SELECT name, label, last_four AS lastFour, ciphertext, initialization_vector AS initializationVector,
              authentication_tag AS authenticationTag, key_version AS keyVersion,
              created_at AS createdAt, updated_at AS updatedAt
       FROM secrets ORDER BY name`,
    )
    .all()
    .map((row) => ({
      name: String(row.name),
      label: typeof row.label === 'string' ? row.label : null,
      lastFour: String(row.lastFour),
      ciphertext: String(row.ciphertext),
      initializationVector: String(row.initializationVector),
      authenticationTag: String(row.authenticationTag),
      keyVersion: Number(row.keyVersion),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    }))

const writeSecretRow = (database: DatabaseSync, row: StoredSecretRow): void => {
  database
    .prepare(
      `INSERT INTO secrets (name, label, last_four, ciphertext, initialization_vector, authentication_tag, key_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         label = excluded.label, last_four = excluded.last_four, ciphertext = excluded.ciphertext,
         initialization_vector = excluded.initialization_vector, authentication_tag = excluded.authentication_tag,
         key_version = excluded.key_version, updated_at = excluded.updated_at`,
    )
    .run(
      row.name,
      row.label,
      row.lastFour,
      row.ciphertext,
      row.initializationVector,
      row.authenticationTag,
      row.keyVersion,
      row.createdAt,
      row.updatedAt,
    )
}

const runInTransaction = (database: DatabaseSync, work: () => void): void => {
  database.exec('BEGIN IMMEDIATE')
  try {
    work()
    database.exec('COMMIT')
  } catch (transactionError) {
    database.exec('ROLLBACK')
    throw transactionError
  }
}

const assertPassphraseStrength = (passphrase: string): void => {
  if (passphrase.length < minimumPassphraseLength) {
    throw new Error(`The passphrase must be at least ${minimumPassphraseLength} characters`)
  }
}

/**
 * Creates the encrypted credential vault on a SQLite database.
 * @param database The database that holds the encrypted rows.
 * @param options Whether the key comes from the environment or a passphrase.
 * @returns The vault.
 */
export const createVault = (database: DatabaseSync, options: VaultOptions): Vault => {
  createSchema(database)

  const vaultMemory: { activeKey: Buffer | null } = { activeKey: null }

  const initialiseEnvironmentKey = (environmentKey: Buffer): void => {
    const existingVerifier = readVerifier(database)
    if (existingVerifier === null) {
      writeVerifierForKey(database, environmentKey)
      vaultMemory.activeKey = environmentKey
      return
    }
    vaultMemory.activeKey = keyMatchesVerifier(environmentKey, existingVerifier) ? environmentKey : null
  }

  if (options.mode === 'environment' && options.environmentKey !== null) {
    initialiseEnvironmentKey(options.environmentKey)
  }

  const requireActiveKey = (): Buffer => {
    if (vaultMemory.activeKey === null) throw new Error('The vault is locked')
    return vaultMemory.activeKey
  }

  const deriveFromStoredSalt = (passphrase: string): Buffer => {
    const encodedSalt = readMeta(database, 'salt')
    if (encodedSalt === null) throw new Error('The vault has not been set up')
    return deriveKeyFromPassphrase(passphrase, Buffer.from(encodedSalt, 'base64'))
  }

  const readState = (): VaultState => ({
    mode: options.mode,
    initialised: readVerifier(database) !== null,
    unlocked: vaultMemory.activeKey !== null,
  })

  const initialise = (passphrase: string): void => {
    if (options.mode !== 'passphrase') throw new Error('The vault key comes from the environment')
    if (readVerifier(database) !== null) throw new Error('The vault is already set up')
    assertPassphraseStrength(passphrase)
    const salt = generateSalt()
    const derivedKey = deriveKeyFromPassphrase(passphrase, salt)
    runInTransaction(database, () => {
      writeMeta(database, 'salt', salt.toString('base64'))
      writeMeta(database, 'key_version', '1')
      writeVerifierForKey(database, derivedKey)
    })
    vaultMemory.activeKey = derivedKey
  }

  const unlock = (passphrase: string): void => {
    if (options.mode !== 'passphrase') throw new Error('Restart the dashboard with the correct master key')
    const verifier = readVerifier(database)
    if (verifier === null) throw new Error('The vault has not been set up')
    const derivedKey = deriveFromStoredSalt(passphrase)
    if (!keyMatchesVerifier(derivedKey, verifier)) throw new Error('Wrong passphrase')
    vaultMemory.activeKey = derivedKey
  }

  const lock = (): void => {
    if (options.mode === 'passphrase') vaultMemory.activeKey = null
  }

  const rotate = (nextKeyMaterial: string): void => {
    const currentKey = requireActiveKey()
    const nextSalt = options.mode === 'passphrase' ? generateSalt() : null
    if (nextSalt !== null) assertPassphraseStrength(nextKeyMaterial)
    const nextKey = nextSalt === null ? parseEncodedKey(nextKeyMaterial) : deriveKeyFromPassphrase(nextKeyMaterial, nextSalt)
    const nextVersion = readKeyVersion(database) + 1
    const rewrittenAt = new Date().toISOString()
    runInTransaction(database, () => {
      readSecretRows(database)
        .map((row) => ({
          ...row,
          ...encryptValue(nextKey, decryptValue(currentKey, row, row.name), row.name),
          keyVersion: nextVersion,
          updatedAt: rewrittenAt,
        }))
        .forEach((row) => writeSecretRow(database, row))
      if (nextSalt !== null) writeMeta(database, 'salt', nextSalt.toString('base64'))
      writeMeta(database, 'key_version', String(nextVersion))
      writeVerifierForKey(database, nextKey)
    })
    vaultMemory.activeKey = nextKey
  }

  // A credential's tokens, oldest first; the one in use is the one its pointer names, or the oldest
  // when the pointer is missing or names a token that was removed.
  const entryRowsOf = (name: string): { entryId: string; row: StoredSecretRow }[] =>
    readSecretRows(database)
      .flatMap((row) => {
        const entryId = entryIdOf(name, row.name)
        return entryId === null ? [] : [{ entryId, row }]
      })
      .toSorted((first, second) => first.row.createdAt.localeCompare(second.row.createdAt) || first.row.name.localeCompare(second.row.name))

  const inUseRowOf = (name: string): StoredSecretRow | null => {
    const entryRows = entryRowsOf(name)
    const pointedRowName = readMeta(database, inUseMetaKey(name))
    return (entryRows.find((entryRow) => entryRow.row.name === pointedRowName) ?? entryRows[0])?.row ?? null
  }

  const requireEntryRow = (name: string, entryId: string): StoredSecretRow => {
    const entryRow = entryRowsOf(name).find((candidate) => candidate.entryId === entryId)
    if (entryRow === undefined) throw new Error('Unknown token')
    return entryRow.row
  }

  const trimmedValueOf = (value: string): string => {
    const trimmedValue = value.trim()
    if (trimmedValue.length === 0) throw new Error('The value is empty')
    return trimmedValue
  }

  const writeEntry = (rowName: string, label: string | null, value: string, createdAt: string | null): void => {
    const savedAt = new Date().toISOString()
    writeSecretRow(database, {
      name: rowName,
      label,
      lastFour: lastFourCharacters(value),
      ...encryptValue(requireActiveKey(), value, rowName),
      keyVersion: readKeyVersion(database),
      createdAt: createdAt ?? savedAt,
      updatedAt: savedAt,
    })
  }

  const listSecrets = (definitions: SecretDefinition[]): SecretSummary[] =>
    definitions.map((definition) => {
      const inUseRow = inUseRowOf(definition.name)
      const entries = entryRowsOf(definition.name).map(
        ({ entryId, row }): SecretEntrySummary => ({
          entryId,
          label: row.label ?? firstEntryLabel,
          lastFour: row.lastFour,
          isInUse: row.name === inUseRow?.name,
          updatedAt: row.updatedAt,
        }),
      )
      return { ...definition, entries }
    })

  const addSecretEntry = (name: string, label: string, value: string): string => {
    const trimmedValue = trimmedValueOf(value)
    const entryId = entryRowsOf(name).length === 0 ? firstEntryId : randomBytes(4).toString('hex')
    writeEntry(rowNameOf(name, entryId), label.trim() || firstEntryLabel, trimmedValue, null)
    return entryId
  }

  const updateSecretEntry = (name: string, entryId: string, change: { label?: string; value?: string }): void => {
    const entryRow = requireEntryRow(name, entryId)
    const label = change.label === undefined ? entryRow.label : change.label.trim() || firstEntryLabel
    const value = change.value === undefined ? decryptValue(requireActiveKey(), entryRow, entryRow.name) : trimmedValueOf(change.value)
    writeEntry(entryRow.name, label, value, entryRow.createdAt)
  }

  const useSecretEntry = (name: string, entryId: string): void => {
    writeMeta(database, inUseMetaKey(name), requireEntryRow(name, entryId).name)
  }

  const deleteSecretEntry = (name: string, entryId: string): void => {
    database.prepare('DELETE FROM secrets WHERE name = ?').run(requireEntryRow(name, entryId).name)
  }

  const readSecretEntryValue = (name: string, entryId: string): string | null => {
    const entryRow = entryRowsOf(name).find((candidate) => candidate.entryId === entryId)?.row
    return entryRow === undefined ? null : decryptValue(requireActiveKey(), entryRow, entryRow.name)
  }

  // A credential that holds one value, such as a routine's token: saving replaces the token in use.
  const saveSecret = (name: string, value: string): void => {
    const inUseRow = inUseRowOf(name)
    if (inUseRow === null) {
      addSecretEntry(name, firstEntryLabel, value)
      return
    }
    writeEntry(inUseRow.name, inUseRow.label, trimmedValueOf(value), inUseRow.createdAt)
  }

  const deleteSecret = (name: string): void => {
    runInTransaction(database, () => {
      entryRowsOf(name).forEach(({ row }) => database.prepare('DELETE FROM secrets WHERE name = ?').run(row.name))
      database.prepare('DELETE FROM vault_meta WHERE key = ?').run(inUseMetaKey(name))
    })
  }

  const readSecretValue = (name: string): string | null => {
    const inUseRow = inUseRowOf(name)
    return inUseRow === null ? null : decryptValue(requireActiveKey(), inUseRow, inUseRow.name)
  }

  const readAllSecretValues = (): string[] =>
    vaultMemory.activeKey === null
      ? []
      : readSecretRows(database).map((row) => decryptValue(requireActiveKey(), row, row.name))

  return {
    readState,
    initialise,
    unlock,
    lock,
    rotate,
    listSecrets,
    saveSecret,
    deleteSecret,
    readSecretValue,
    addSecretEntry,
    updateSecretEntry,
    useSecretEntry,
    deleteSecretEntry,
    readSecretEntryValue,
    readAllSecretValues,
  }
}
