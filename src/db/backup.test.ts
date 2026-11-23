import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BackupError,
  backupFileName,
  buildBackup,
  emptyBackupData,
  parseBackup,
  serializeBackup,
  summarizeBackup,
} from './backup'
import { BACKUP_TABLES, SCHEMA_VERSION, primaryKeyFields } from './schema'
import { DEFAULT_SETTINGS } from './defaults'
import { sessionRow } from '../test/fixtures'

const NOW = Date.UTC(2026, 10, 23, 12)

const validText = (patch: (b: Record<string, any>) => void = () => {}) => {
  const data = emptyBackupData()
  data.settings = [{ ...DEFAULT_SETTINGS }]
  data.sessions = [sessionRow({ id: 's1' })]
  data.travelTimes = [{ fromId: 'a', toId: 'b', minutes: 20 }]
  data.checkIns = [{ date: '2026-11-22', energy: 4, mood: 3 }]
  const b = JSON.parse(serializeBackup(buildBackup(data, NOW)))
  patch(b)
  return JSON.stringify(b)
}

const expectError = (text: string, msg: RegExp) => {
  expect(() => parseBackup(text)).toThrow(BackupError)
  expect(() => parseBackup(text)).toThrow(msg)
}

describe('schema helpers', () => {
  it('reads simple and compound primary keys', () => {
    expect(primaryKeyFields('goals')).toEqual(['id'])
    expect(primaryKeyFields('travelTimes')).toEqual(['fromId', 'toId'])
    expect(primaryKeyFields('checkIns')).toEqual(['date'])
  })

  it('excludes device-only meta from backups', () => {
    expect(BACKUP_TABLES).not.toContain('meta')
    expect(BACKUP_TABLES).toContain('goals')
  })
})

describe('parseBackup', () => {
  it('round-trips a serialized backup', () => {
    const parsed = parseBackup(validText())
    expect(parsed.format).toBe(BACKUP_FORMAT)
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.exportedAt).toBe(NOW)
    expect(parsed.data.sessions[0]!.id).toBe('s1')
    expect(parsed.data.travelTimes).toHaveLength(1)
  })

  it('fills missing tables with [] and ignores unknown ones', () => {
    const parsed = parseBackup(
      validText((b) => {
        delete b.data.goals
        b.data.somethingFromTheFuture = [{ id: 'x' }]
      }),
    )
    expect(parsed.data.goals).toEqual([])
    expect(parsed.data).not.toHaveProperty('somethingFromTheFuture')
    expect(Object.keys(parsed.data).sort()).toEqual([...BACKUP_TABLES].sort())
  })

  it('rejects non-JSON', () => expectError('not json {', /not valid JSON/))
  it('rejects other JSON files', () => expectError('{"hello": 1}', /not an Agenda backup/))
  it('rejects arrays', () => expectError('[]', /not an Agenda backup/))

  it('rejects backups from a newer app version', () =>
    expectError(validText((b) => (b.schemaVersion = SCHEMA_VERSION + 1)), /newer version/))

  it('rejects too-old or invalid versions', () => {
    expectError(validText((b) => (b.schemaVersion = 1)), /unsupported old version/)
    expectError(validText((b) => (b.schemaVersion = '2')), /version number/)
  })

  it('requires an export date and a data object', () => {
    expectError(validText((b) => delete b.exportedAt), /export date/)
    expectError(validText((b) => (b.data = [])), /no data/)
  })

  it('rejects a table that is not a list', () =>
    expectError(validText((b) => (b.data.goals = { id: 'g' })), /"goals" in the backup is not a list/))

  it('rejects rows that are not objects', () =>
    expectError(validText((b) => (b.data.goals = ['oops'])), /"goals" row 1 is not an object/))

  it('rejects rows without a primary key', () => {
    expectError(validText((b) => delete b.data.sessions[0].id), /"sessions" row 1 is missing its id/)
    expectError(
      validText((b) => (b.data.travelTimes = [{ fromId: 'a', minutes: 5 }])),
      /missing its fromId \+ toId/,
    )
    expectError(validText((b) => (b.data.sessions[0].id = 42)), /missing its id/)
  })

  it('rejects duplicate keys', () => {
    expectError(
      validText((b) => b.data.sessions.push({ ...b.data.sessions[0] })),
      /"sessions" contains a duplicate entry \(s1\)/,
    )
    expectError(
      validText((b) => b.data.travelTimes.push({ fromId: 'a', toId: 'b', minutes: 99 })),
      /duplicate entry \(a \+ b\)/,
    )
  })

  it('allows the same pair in the other direction', () => {
    const parsed = parseBackup(validText((b) => b.data.travelTimes.push({ fromId: 'b', toId: 'a', minutes: 20 })))
    expect(parsed.data.travelTimes).toHaveLength(2)
  })

  it('enforces the fixed id of singleton tables', () => {
    expectError(validText((b) => (b.data.settings[0].id = 'other')), /"settings" row 1 has an invalid id/)
    expectError(
      validText((b) => (b.data.activeTimer = [{ id: 'nope', goalId: 'g' }])),
      /"activeTimer" row 1 has an invalid id/,
    )
  })
})

describe('summarizeBackup / backupFileName', () => {
  it('counts only non-empty tables', () => {
    expect(summarizeBackup(parseBackup(validText()))).toEqual({
      settings: 1,
      sessions: 1,
      travelTimes: 1,
      checkIns: 1,
    })
  })

  it('names the file by local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59).getTime())).toBe('agenda-backup-2026-01-05.json')
  })
})
