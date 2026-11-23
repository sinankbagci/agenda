import { useEffect, useRef, useState } from 'react'
import { BackupError, backupFileName, parseBackup, serializeBackup, summarizeBackup } from '../../db/backup'
import { exportBackup, importBackup, markBackedUp } from '../../db/backupDb'
import { saveJsonFile } from '../../db/backupFile'
import { repos } from '../../db/repositories'

type Status = { kind: 'ok' | 'error'; text: string } | null

/** [singular, plural] for the tables worth mentioning in the confirm dialog. */
const LABELS: Record<string, [string, string]> = {
  goals: ['goal', 'goals'],
  topics: ['topic', 'topics'],
  fixedBlocks: ['fixed block', 'fixed blocks'],
  sessions: ['session', 'sessions'],
  focusIntervals: ['focus interval', 'focus intervals'],
  logEntries: ['log entry', 'log entries'],
  checkIns: ['check-in', 'check-ins'],
  backlogItems: ['backlog item', 'backlog items'],
  locations: ['location', 'locations'],
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function BackupSection() {
  const [lastBackupAt, setLastBackupAt] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    repos.settings.get().then((s) => setLastBackupAt(s.lastBackupAt))
  }, [])

  async function onExport() {
    setBusy(true)
    setStatus(null)
    try {
      const now = Date.now()
      const backup = await exportBackup(now)
      const result = await saveJsonFile(backupFileName(now), serializeBackup(backup))
      if (result === 'cancelled') return
      await markBackedUp(now)
      setLastBackupAt(now)
      setStatus({ kind: 'ok', text: 'Backup created. Keep it somewhere safe, like iCloud Drive in Files.' })
    } catch (e) {
      setStatus({ kind: 'error', text: `Export failed: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setBusy(true)
    setStatus(null)
    try {
      const backup = parseBackup(await file.text())
      const counts = Object.entries(summarizeBackup(backup))
        .filter(([t]) => t in LABELS)
        .map(([t, n]) => `${n} ${LABELS[t]![n === 1 ? 0 : 1]}`)
      const ok = window.confirm(
        `Replace ALL data on this iPad with the backup from ${formatDate(backup.exportedAt)}?\n\n` +
          `It contains: ${counts.length ? counts.join(', ') : 'settings only'}.\n\n` +
          'Your current data will be overwritten. This cannot be undone.',
      )
      if (!ok) return
      await importBackup(backup)
      const s = await repos.settings.get()
      setLastBackupAt(s.lastBackupAt)
      setStatus({ kind: 'ok', text: 'Backup restored.' })
    } catch (e) {
      const msg = e instanceof BackupError ? e.message : `Import failed: ${(e as Error).message}`
      setStatus({ kind: 'error', text: `${msg} Nothing was changed.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Backup</h2>
      <div className="card">
        <p className="muted">
          Your data only lives on this iPad. Export a backup regularly and keep it in Files or iCloud Drive.
        </p>
        <p>
          Last backup: <strong>{lastBackupAt ? formatDate(lastBackupAt) : 'never'}</strong>
        </p>
        <div className="button-row">
          <button className="btn primary" onClick={onExport} disabled={busy}>
            Export backup
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import backup…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onFileChosen}
          />
        </div>
        {status && (
          <p className={status.kind === 'ok' ? 'ok' : 'error'} role="status">
            {status.text}
          </p>
        )}
      </div>
    </>
  )
}
