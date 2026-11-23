import { describe, expect, it } from 'vitest'
import { exportBackup, importBackup, markBackedUp } from './backupDb'
import { parseBackup, serializeBackup } from './backup'
import { createRepos } from './repositories'
import { BACKUP_TABLES } from './schema'
import { freshDb, goalInput, sessionRow } from '../test/fixtures'

const NOW = Date.UTC(2026, 10, 23, 12)

async function seed() {
  const db = freshDb()
  const r = createRepos(db)
  const g = await r.goals.add(goalInput())
  await r.topics.append({ goalId: g.id, name: 'Rings', weight: 1.5, weak: true, done: false, reviewsDone: 0 })
  const home = await r.locations.add({ name: 'Home' })
  const campus = await r.locations.add({ name: 'Campus' })
  await r.travelTimes.set(home.id, campus.id, 20)
  await r.settings.update({ bufferMin: 15, homeLocationId: home.id })
  await r.sessions.bulkPut([sessionRow({ goalId: g.id }), sessionRow({ goalId: g.id, status: 'done' })])
  await r.checkIns.put({ date: '2026-11-22', energy: 4, mood: 5 })
  await r.stats.put({ goalId: g.id, bucket: 'evening', attempts: 2, completions: 2, focusMinutes: 90 })
  await r.activeTimer.set({ goalId: g.id, phase: 'work', phaseStartedAt: NOW - 60_000, phaseLength: 25, cycle: 1 })
  await db.meta.put({ key: 'storagePersisted', value: 'true' })
  return { db, r }
}

async function dump(db: ReturnType<typeof freshDb>) {
  const out: Record<string, unknown[]> = {}
  for (const t of BACKUP_TABLES) out[t] = await db.table(t).toArray()
  return out
}

describe('export / import', () => {
  it('round-trips every table through JSON into an empty database', async () => {
    const { db: source } = await seed()
    const backup = await exportBackup(NOW, source)

    const target = freshDb()
    await importBackup(parseBackup(serializeBackup(backup)), target)

    const expected = await dump(source)
    expected.settings = [{ ...(expected.settings![0] as object), lastBackupAt: NOW }]
    expect(await dump(target)).toEqual(expected)
  })

  it('export writes nothing; markBackedUp records lastBackupAt', async () => {
    const { db, r } = await seed()
    const before = await dump(db)
    const backup = await exportBackup(NOW, db)
    expect(await dump(db)).toEqual(before)
    expect((await r.settings.get()).lastBackupAt).toBeUndefined()
    // ...but the exported copy already carries it (and the user's settings)
    expect(backup.data.settings[0]!.lastBackupAt).toBe(NOW)
    expect(backup.data.settings[0]!.bufferMin).toBe(15)

    await markBackedUp(NOW, db)
    expect((await r.settings.get())).toMatchObject({ lastBackupAt: NOW, bufferMin: 15 })
  })

  it('exports complete settings even if none were ever saved', async () => {
    const backup = await exportBackup(NOW, freshDb())
    expect(backup.data.settings).toHaveLength(1)
    expect(backup.data.settings[0]!.sleepStart).toBe('00:00')
  })

  it('does not export device-only meta', async () => {
    const { db } = await seed()
    const backup = await exportBackup(NOW, db)
    expect(backup.data).not.toHaveProperty('meta')
  })

  it('import replaces existing data instead of merging, and leaves meta alone', async () => {
    const { db: source } = await seed()
    const backup = await exportBackup(NOW, source)

    const target = freshDb()
    const rt = createRepos(target)
    await rt.goals.add(goalInput({ name: 'Should disappear' }))
    await rt.sessions.bulkPut([sessionRow(), sessionRow(), sessionRow()])
    await target.meta.put({ key: 'storagePersisted', value: 'false' })

    await importBackup(backup, target)

    expect((await rt.goals.all()).map((g) => g.name)).toEqual(['Algebra midterm'])
    expect(await rt.sessions.all()).toHaveLength(2)
    expect(await target.meta.get('storagePersisted')).toEqual({ key: 'storagePersisted', value: 'false' })
  })

  it('is all-or-nothing: a failing import leaves the old data untouched', async () => {
    const { db } = await seed()
    const before = await dump(db)

    const bad = await exportBackup(NOW, freshDb())
    bad.data.goals = [{ ...goalInput(), id: 'new' }]
    // Bypasses parseBackup on purpose: duplicate keys make bulkAdd fail mid-import.
    bad.data.sessions = [sessionRow({ id: 'dup' }), sessionRow({ id: 'dup' })]

    await expect(importBackup(bad, db)).rejects.toThrow()
    expect(await dump(db)).toEqual(before)
  })
})
