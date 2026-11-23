import { describe, expect, it } from 'vitest'
import { backupReminderDue, daysSinceBackup, snoozeUntil } from './backupReminder'

const D = 24 * 60 * 60 * 1000
const now = new Date('2026-11-23T10:00').getTime()

describe('backup reminder', () => {
  it('after 14 days without a backup', () => {
    expect(backupReminderDue({ lastBackupAt: now - 13 * D, hasData: true, now })).toBe(false)
    expect(backupReminderDue({ lastBackupAt: now - 14 * D, hasData: true, now })).toBe(true)
  })
  it('never backed up: counts from the first launch', () => {
    expect(backupReminderDue({ firstLaunchAt: now - 3 * D, hasData: true, now })).toBe(false)
    expect(backupReminderDue({ firstLaunchAt: now - 20 * D, hasData: true, now })).toBe(true)
    expect(backupReminderDue({ hasData: true, now })).toBe(false)
  })
  it('not with nothing to save, not while snoozed', () => {
    expect(backupReminderDue({ lastBackupAt: now - 30 * D, hasData: false, now })).toBe(false)
    expect(backupReminderDue({ lastBackupAt: now - 30 * D, snoozedUntil: now + D, hasData: true, now })).toBe(false)
    expect(backupReminderDue({ lastBackupAt: now - 30 * D, snoozedUntil: now - 1, hasData: true, now })).toBe(true)
    expect(snoozeUntil(now)).toBe(now + 3 * D)
  })
  it('days since', () => {
    expect(daysSinceBackup(undefined, now)).toBeUndefined()
    expect(daysSinceBackup(now - 15.5 * D, now)).toBe(15)
  })
})
