import { backupFileName, serializeBackup } from '../../db/backup'
import { exportBackup, markBackedUp } from '../../db/backupDb'
import { saveJsonFile } from '../../db/backupFile'

/** Export a backup and open the share / save sheet. `lastBackupAt` only moves when it was saved. */
export async function exportNow(now = Date.now()): Promise<'saved' | 'cancelled'> {
  const backup = await exportBackup(now)
  const result = await saveJsonFile(backupFileName(now), serializeBackup(backup))
  if (result === 'cancelled') return 'cancelled'
  await markBackedUp(now)
  return 'saved'
}
