/**
 * JSON backup format + validation. Pure: no Dexie, no DOM — see backupDb.ts for the I/O.
 *
 * A backup is a full snapshot of every user-data table. Import REPLACES all data.
 */
import { BACKUP_TABLES, SCHEMA_VERSION, primaryKeyFields, type BackupTableName, type TableRows } from './schema'
import type { EpochMs } from './types'

export const BACKUP_FORMAT = 'agenda-backup'

/** Oldest schema version whose backups we can still read. */
export const MIN_BACKUP_SCHEMA_VERSION = 2

export type BackupData = { [K in BackupTableName]: TableRows[K][] }

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: number
  exportedAt: EpochMs
  data: BackupData
}

export class BackupError extends Error {
  override name = 'BackupError'
}

export function emptyBackupData(): BackupData {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])) as unknown as BackupData
}

export function buildBackup(data: BackupData, exportedAt: EpochMs): Backup {
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, data }
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 1)
}

/** e.g. agenda-backup-2026-11-23.json (local date). */
export function backupFileName(exportedAt: EpochMs): string {
  const d = new Date(exportedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `agenda-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Singleton tables must use their fixed key. */
const FIXED_KEYS: Partial<Record<BackupTableName, string>> = { settings: 'settings', activeTimer: 'active' }

/**
 * Parse and validate backup text. Throws BackupError with a message fit to show the user.
 * - Unknown tables are ignored; tables missing from the file become empty.
 * - Every row must be an object with a non-empty string primary key, and keys must be unique.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('This file is not valid JSON.')
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not an Agenda backup.')
  }
  const { schemaVersion, exportedAt, data } = raw
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    throw new BackupError('The backup has no valid version number.')
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      'This backup was made by a newer version of Agenda. Open the app while online to update it, then try again.',
    )
  }
  if (schemaVersion < MIN_BACKUP_SCHEMA_VERSION) {
    throw new BackupError('This backup is from an unsupported old version.')
  }
  if (typeof exportedAt !== 'number' || !Number.isFinite(exportedAt)) {
    throw new BackupError('The backup has no valid export date.')
  }
  if (!isObject(data)) {
    throw new BackupError('The backup contains no data.')
  }

  const out = emptyBackupData() as Record<BackupTableName, unknown[]>
  for (const table of BACKUP_TABLES) {
    const rows = data[table]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) throw new BackupError(`"${table}" in the backup is not a list.`)
    const pkFields = primaryKeyFields(table)
    const seen = new Set<string>()
    rows.forEach((row, i) => {
      if (!isObject(row)) throw new BackupError(`"${table}" row ${i + 1} is not an object.`)
      const key = pkFields.map((f) => row[f])
      if (key.some((k) => typeof k !== 'string' || k === '')) {
        throw new BackupError(`"${table}" row ${i + 1} is missing its ${pkFields.join(' + ')}.`)
      }
      const fixed = FIXED_KEYS[table]
      if (fixed && key[0] !== fixed) throw new BackupError(`"${table}" row ${i + 1} has an invalid id.`)
      const keyStr = JSON.stringify(key)
      if (seen.has(keyStr)) throw new BackupError(`"${table}" contains a duplicate entry (${key.join(' + ')}).`)
      seen.add(keyStr)
    })
    out[table] = rows
  }

  return { format: BACKUP_FORMAT, schemaVersion, exportedAt, data: out as unknown as BackupData }
}

/** Row counts for the confirm dialog, e.g. { goals: 3, sessions: 120 }. Only non-empty tables. */
export function summarizeBackup(backup: Backup): Partial<Record<BackupTableName, number>> {
  const summary: Partial<Record<BackupTableName, number>> = {}
  for (const t of BACKUP_TABLES) {
    const n = backup.data[t].length
    if (n) summary[t] = n
  }
  return summary
}
