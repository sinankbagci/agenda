import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { backupReminderDue, daysSinceBackup, snoozeUntil } from '../../domain/backupReminder'
import { exportNow } from './exportNow'

/** On Today: gentle "back up your data" reminder after 14 days without a backup. */
export function BackupReminder() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const state = useLiveQuery(async () => {
    const [settings, first, snooze, goals, sessions] = await Promise.all([
      repos.settings.get(),
      db.meta.get('firstLaunchAt'),
      db.meta.get('backupSnoozedUntil'),
      db.goals.count(),
      db.sessions.count(),
    ])
    return {
      lastBackupAt: settings.lastBackupAt,
      firstLaunchAt: first ? Number(first.value) : undefined,
      snoozedUntil: snooze ? Number(snooze.value) : undefined,
      hasData: goals + sessions > 0,
    }
  }, [])
  const now = Date.now() // fine here: only decides whether to show a banner
  if (!state || !backupReminderDue({ ...state, now })) return null
  const days = daysSinceBackup(state.lastBackupAt, now)

  const backup = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await exportNow()
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card backup-banner" role="status">
      <span>
        💾 <strong>{days === undefined ? 'You haven’t made a backup yet' : `No backup in ${days} days`}</strong> — your data only lives on this iPad. Save a copy to Files or iCloud
        Drive.
      </span>
      <span className="button-row">
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void backup()}>
          {busy ? 'Preparing…' : 'Back up now'}
        </button>
        <button type="button" className="btn small link" onClick={() => void db.meta.put({ key: 'backupSnoozedUntil', value: String(snoozeUntil(Date.now())) })}>
          Later
        </button>
      </span>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
