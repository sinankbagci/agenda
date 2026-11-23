import { describe, expect, it } from 'vitest'
import { lastPlanWarnings, replan } from './planStore'
import { createRepos } from './repositories'
import { freshDb } from '../test/fixtures'
import { toMinutes } from '../domain/time'
import { midterm, reading, scenarioSetup, workout } from '../test/scenario'

const MON = new Date(2026, 10, 23, 7, 0) // Mon 23 Nov 2026, 07:00 local
const MON_EVENING = new Date(2026, 10, 23, 20, 0)

async function seeded() {
  const db = freshDb()
  const r = createRepos(db)
  const s = scenarioSetup()
  await r.settings.update({ ...s.settings, dailyCapWeekday: 6, dailyCapWeekend: 4, demandingCap: 4 })
  await db.fixedBlocks.bulkPut([...s.fixedBlocks])
  await db.availabilityWindows.bulkPut([...s.availabilityWindows])
  await db.mealRules.bulkPut([...s.mealRules])
  await db.locations.bulkPut([...s.locations])
  await db.travelTimes.bulkPut([...s.travelTimes])
  await db.goals.bulkPut([midterm, workout, reading])
  return { db, r }
}

describe('replan (database)', () => {
  it('saves a plan and its warnings', async () => {
    const { db, r } = await seeded()
    const result = await replan(MON, {}, db)
    expect(result.from).toBe('2026-11-23')
    expect(await db.sessions.count()).toBe(result.sessions.length)
    expect((await r.sessions.byDate('2026-11-23')).some((s) => s.goalId === 'midterm')).toBe(true)
    expect((await lastPlanWarnings(db)).map((w) => w.kind)).toEqual(result.warnings.map((w) => w.kind))
  })

  it('keeps today frozen on a later re-plan, but regenerates from tomorrow', async () => {
    const { db, r } = await seeded()
    await replan(MON, {}, db)
    const todayBefore = await r.sessions.byDate('2026-11-23')
    await r.goals.update('reading', { minutesPerDay: 15, minSession: 15, maxSession: 15 })
    const again = await replan(MON_EVENING, {}, db)
    expect(again.from).toBe('2026-11-24')
    expect(await r.sessions.byDate('2026-11-23')).toEqual(todayBefore)
    // the edit (reading 30 → 15 min) shows up from tomorrow, not today
    const mins = (s: { start: string; end: string }) => toMinutes(s.end) - toMinutes(s.start)
    const readingOn = async (d: string) => (await r.sessions.byDate(d)).filter((s) => s.goalId === 'reading').reduce((m, s) => m + mins(s), 0)
    expect(await readingOn('2026-11-23')).toBe(30)
    expect(await readingOn('2026-11-24')).toBe(15)
  })

  it('“Re-plan today” regenerates today too, without touching done sessions', async () => {
    const { db, r } = await seeded()
    await replan(MON, {}, db)
    const mid = (await r.sessions.byDate('2026-11-23')).find((s) => s.goalId === 'midterm')!
    await r.sessions.update(mid.id, { status: 'done', actualMinutes: 55 })
    await replan(MON_EVENING, { includeToday: true }, db)
    const after = await r.sessions.get(mid.id)
    expect(after).toMatchObject({ status: 'done', actualMinutes: 55, goalId: 'midterm' })
    const today = await r.sessions.byDate('2026-11-23')
    expect(new Set(today.map((s) => s.id)).size).toBe(today.length)
    // nothing new overlaps the done session
    for (const s of today.filter((x) => x.id !== mid.id && x.kind !== 'travel' && x.kind !== 'meal')) {
      expect(s.end <= mid.start || s.start >= mid.end).toBe(true)
    }
  })

  it('“Re-plan today” keeps sessions that already started and plans nothing before now', async () => {
    const { db, r } = await seeded()
    await replan(MON, {}, db)
    const at1630 = new Date(2026, 10, 23, 16, 30)
    const inProgress = (await r.sessions.byDate('2026-11-23')).find((s) => s.goalId === 'midterm')!
    expect(inProgress.start).toBe('16:00')
    await r.goals.update('reading', { minutesPerDay: 15, minSession: 15, maxSession: 15 })
    await replan(at1630, { includeToday: true }, db)
    const today = await r.sessions.byDate('2026-11-23')
    expect(today.find((s) => s.id === inProgress.id)).toMatchObject({ start: '16:00', status: 'planned', frozen: true })
    for (const s of today.filter((x) => x.id !== inProgress.id && x.goalId && !x.frozen)) {
      expect(toMinutes(s.start)).toBeGreaterThanOrEqual(16 * 60 + 30)
    }
    const readingToday = today.filter((s) => s.goalId === 'reading')
    expect(readingToday.map((s) => toMinutes(s.end) - toMinutes(s.start))).toEqual([15]) // the edit applied to the rest of today
  })

  it('a today with no goal work yet is still re-planned (e.g. goals added during onboarding)', async () => {
    const { db, r } = await seeded()
    await db.goals.clear()
    const first = await replan(MON, {}, db)
    expect(first.sessions.some((s) => s.date === '2026-11-23' && s.kind === 'meal')).toBe(true)
    await db.goals.put(reading)
    const second = await replan(MON, {}, db)
    expect(second.from).toBe('2026-11-23')
    expect((await r.sessions.byDate('2026-11-23')).some((s) => s.goalId === 'reading')).toBe(true)
  })

  it('regression: re-planning a day without goal work never duplicates meals', async () => {
    const { db, r } = await seeded()
    await db.goals.clear()
    await db.mealRules.bulkPut([
      { id: 'breakfast', name: 'Breakfast', windowStart: '07:00', windowEnd: '09:00', duration: 20 },
      { id: 'lunch', name: 'Lunch', windowStart: '13:00', windowEnd: '14:00', duration: 30 },
    ])
    for (const h of [7, 9, 13, 14, 15]) await replan(new Date(2026, 10, 23, h, 15), {}, db)
    const meals = (await r.sessions.byDate('2026-11-23')).filter((s) => s.kind === 'meal').map((s) => s.label)
    // Breakfast is before "now" in every run (the case that used to duplicate); Lunch can't fit (classes 9–15)
    expect(meals.sort()).toEqual(['Breakfast', 'Dinner'])
  })

  it('repairs meal / travel blocks that were already duplicated', async () => {
    const { db, r } = await seeded()
    await replan(MON, {}, db)
    const dinner = (await r.sessions.byDate('2026-11-24')).find((s) => s.kind === 'meal')!
    const lunchToday = { ...dinner, date: '2026-11-23', start: '13:00', end: '13:30', label: 'Lunch', mealId: 'lunch' }
    await db.sessions.bulkPut([1, 2, 3, 4].map((n) => ({ ...lunchToday, id: `dup${n}`, frozen: true })))
    await replan(new Date(2026, 10, 23, 13, 15), { includeToday: true }, db)
    expect((await r.sessions.byDate('2026-11-23')).filter((s) => s.label === 'Lunch')).toHaveLength(1)
  })

  it('does not duplicate sessions when run repeatedly', async () => {
    const { db } = await seeded()
    const first = await replan(MON, {}, db)
    await replan(MON, { includeToday: true }, db)
    await replan(MON, { includeToday: true }, db)
    expect(await db.sessions.count()).toBe(first.sessions.length)
  })
})
