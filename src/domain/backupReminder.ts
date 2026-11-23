/**
 * "No backup in 14 days" reminder (SPEC §1 storage safety). PURE.
 * Counts from the last backup, or — never backed up — from the first launch, so a brand-new
 * install isn't nagged on day one. "Later" snoozes it for a few days.
 */
export const BACKUP_REMIND_DAYS = 14
export const BACKUP_SNOOZE_DAYS = 3
const DAY = 24 * 60 * 60 * 1000

export function backupReminderDue(args: {
  lastBackupAt?: number
  firstLaunchAt?: number
  snoozedUntil?: number
  /** Nothing worth saving yet (no goals, sessions or logs) → no reminder. */
  hasData: boolean
  now: number
}): boolean {
  const { lastBackupAt, firstLaunchAt, snoozedUntil, hasData, now } = args
  if (!hasData) return false
  if (snoozedUntil !== undefined && now < snoozedUntil) return false
  const since = lastBackupAt ?? firstLaunchAt
  if (since === undefined) return false
  return now - since >= BACKUP_REMIND_DAYS * DAY
}

/** Whole days since the last backup (undefined = never). */
export const daysSinceBackup = (lastBackupAt: number | undefined, now: number) =>
  lastBackupAt === undefined ? undefined : Math.floor((now - lastBackupAt) / DAY)

export const snoozeUntil = (now: number) => now + BACKUP_SNOOZE_DAYS * DAY
