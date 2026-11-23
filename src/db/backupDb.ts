import type { Table } from 'dexie'
import { db as defaultDb, type AgendaDB } from './db'
import { buildBackup, emptyBackupData, type Backup, type BackupData } from './backup'
import { BACKUP_TABLES } from './schema'
import { DEFAULT_SETTINGS } from './defaults'
import type { EpochMs } from './types'

const tablesOf = (db: AgendaDB) => BACKUP_TABLES.map((t) => db.table(t) as Table<unknown, unknown>)

/**
 * Consistent snapshot of every user-data table. Doesn't write anything.
 * The snapshot's settings already carry `lastBackupAt = now`, so restoring it
 * doesn't immediately trigger the "no backup" reminder.
 * Call `markBackedUp` once the file has actually been saved/shared.
 */
export async function exportBackup(now: EpochMs, db: AgendaDB = defaultDb): Promise<Backup> {
  return db.transaction('r', tablesOf(db), async () => {
    const data = emptyBackupData() as Record<string, unknown[]>
    for (const t of BACKUP_TABLES) data[t] = await db.table(t).toArray()
    const stored = (data.settings as BackupData['settings'])[0]
    data.settings = [{ ...DEFAULT_SETTINGS, ...stored, lastBackupAt: now }]
    return buildBackup(data as BackupData, now)
  })
}

export async function markBackedUp(now: EpochMs, db: AgendaDB = defaultDb): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const stored = await db.settings.get('settings')
    await db.settings.put({ ...DEFAULT_SETTINGS, ...stored, lastBackupAt: now })
  })
}

/** Replace ALL user data with the backup's contents, atomically (all or nothing). */
export async function importBackup(backup: Backup, db: AgendaDB = defaultDb): Promise<void> {
  await db.transaction('rw', tablesOf(db), async () => {
    for (const t of BACKUP_TABLES) {
      const table = db.table(t)
      await table.clear()
      await table.bulkAdd(backup.data[t])
    }
  })
}
