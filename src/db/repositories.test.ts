import { beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from './repositories'
import type { AgendaDB } from './db'
import { DEFAULT_SETTINGS } from './defaults'
import { freshDb, goalInput, sessionRow } from '../test/fixtures'

let db: AgendaDB
let r: Repos

beforeEach(() => {
  db = freshDb()
  r = createRepos(db)
})

describe('entity CRUD', () => {
  it('adds with a generated id, gets, updates and removes', async () => {
    const g = await r.goals.add(goalInput())
    expect(g.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await r.goals.get(g.id)).toEqual(g)

    await r.goals.update(g.id, { name: 'Renamed', priority: 3 })
    expect(await r.goals.get(g.id)).toMatchObject({ name: 'Renamed', priority: 3, type: 'deadline' })

    await r.fixedBlocks.add({ title: 'Class', rule: { kind: 'weekly', weekdays: [1, 2] }, start: '09:00', end: '15:00', locked: true })
    expect(await r.fixedBlocks.all()).toHaveLength(1)
  })

  it('update throws for a missing row instead of silently doing nothing', async () => {
    await expect(r.goals.update('missing', { name: 'x' })).rejects.toThrow(/no row with id missing/)
  })

  it('active() filters paused goals', async () => {
    await r.goals.add(goalInput({ name: 'A' }))
    await r.goals.add(goalInput({ name: 'B', active: false }))
    expect((await r.goals.active()).map((g) => g.name)).toEqual(['A'])
  })
})

describe('goals.remove', () => {
  it('deletes topics, stats and planned sessions but keeps history', async () => {
    const g = await r.goals.add(goalInput())
    const other = await r.goals.add(goalInput({ name: 'Other' }))
    await r.topics.append({ goalId: g.id, name: 'Groups', weight: 1, weak: false, done: false, reviewsDone: 0 })
    await r.topics.append({ goalId: other.id, name: 'Keep me', weight: 1, weak: false, done: false, reviewsDone: 0 })
    await r.stats.put({ goalId: g.id, bucket: 'evening', attempts: 3, completions: 2, focusMinutes: 120 })
    await r.sessions.bulkPut([
      sessionRow({ id: 'planned', goalId: g.id }),
      sessionRow({ id: 'done', goalId: g.id, status: 'done' }),
      sessionRow({ id: 'skipped', goalId: g.id, status: 'skipped' }),
      sessionRow({ id: 'otherPlanned', goalId: other.id }),
    ])
    await r.focusIntervals.add({ goalId: g.id, phase: 'work', startedAt: 1, endedAt: 2, minutes: 25 })

    await r.goals.remove(g.id)

    expect(await r.goals.get(g.id)).toBeUndefined()
    expect(await r.topics.byGoal(g.id)).toEqual([])
    expect((await r.topics.byGoal(other.id)).map((t) => t.name)).toEqual(['Keep me'])
    expect(await r.stats.byGoal(g.id)).toEqual([])
    expect((await r.sessions.all()).map((s) => s.id).sort()).toEqual(['done', 'otherPlanned', 'skipped'])
    expect(await r.focusIntervals.byGoal(g.id)).toHaveLength(1)
  })
})

describe('topics', () => {
  it('appends in order and reorders', async () => {
    const g = await r.goals.add(goalInput())
    const names = ['Groups', 'Subgroups', 'Rings', 'Homomorphisms']
    const created = []
    for (const name of names) {
      created.push(await r.topics.append({ goalId: g.id, name, weight: 1, weak: false, done: false, reviewsDone: 0 }))
    }
    expect(created.map((t) => t.order)).toEqual([0, 1, 2, 3])
    expect((await r.topics.byGoal(g.id)).map((t) => t.name)).toEqual(names)

    const [a, b, c, d] = created
    await r.topics.reorder(g.id, [c!.id, a!.id, d!.id, b!.id])
    expect((await r.topics.byGoal(g.id)).map((t) => t.name)).toEqual(['Rings', 'Groups', 'Homomorphisms', 'Subgroups'])
  })

  it('refuses to reorder topics of another goal', async () => {
    const g1 = await r.goals.add(goalInput())
    const g2 = await r.goals.add(goalInput())
    const t = await r.topics.append({ goalId: g2.id, name: 'X', weight: 1, weak: false, done: false, reviewsDone: 0 })
    await expect(r.topics.reorder(g1.id, [t.id])).rejects.toThrow(/does not belong/)
    expect((await r.topics.get(t.id))!.order).toBe(0)
  })
})

describe('locations & travel times', () => {
  it('stores travel times symmetrically', async () => {
    await r.travelTimes.set('home', 'campus', 20)
    expect(await r.travelTimes.get('home', 'campus')).toBe(20)
    expect(await r.travelTimes.get('campus', 'home')).toBe(20)
    expect(await r.travelTimes.get('home', 'home')).toBe(0)
    expect(await r.travelTimes.get('home', 'gym')).toBeUndefined()

    await r.travelTimes.set('campus', 'home', 25)
    expect(await r.travelTimes.get('home', 'campus')).toBe(25)

    await r.travelTimes.remove('home', 'campus')
    expect(await r.travelTimes.all()).toEqual([])
  })

  it('removing a location removes its travel times', async () => {
    const home = await r.locations.add({ name: 'Home' })
    const campus = await r.locations.add({ name: 'Campus' })
    const gym = await r.locations.add({ name: 'Gym' })
    await r.travelTimes.set(home.id, campus.id, 20)
    await r.travelTimes.set(home.id, gym.id, 15)
    await r.travelTimes.set(campus.id, gym.id, 10)

    await r.locations.remove(home.id)

    expect((await r.locations.all()).map((l) => l.name).sort()).toEqual(['Campus', 'Gym'])
    expect(await r.travelTimes.all()).toHaveLength(2) // campus<->gym only
    expect(await r.travelTimes.get(campus.id, gym.id)).toBe(10)
  })

  it('removing a location clears references to it everywhere', async () => {
    const gym = await r.locations.add({ name: 'Gym' })
    const campus = await r.locations.add({ name: 'Campus' })
    const block = await r.fixedBlocks.add({ title: 'Class', rule: { kind: 'weekly', weekdays: [1] }, start: '09:00', end: '15:00', locked: true, locationId: campus.id })
    const meal = await r.mealRules.add({ name: 'Lunch', windowStart: '12:00', windowEnd: '14:30', duration: 30, locationId: gym.id })
    const goal = await r.goals.add(goalInput({ type: 'recurring', locationId: gym.id }))
    await r.settings.update({ homeLocationId: gym.id })

    await r.locations.remove(gym.id)

    expect((await r.mealRules.get(meal.id))!.locationId).toBeUndefined()
    expect((await r.goals.get(goal.id))!.locationId).toBeUndefined()
    expect((await r.fixedBlocks.get(block.id))!.locationId).toBe(campus.id)
    expect((await r.settings.get()).homeLocationId).toBeUndefined()
  })
})

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await r.settings.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges updates and keeps defaults for missing fields', async () => {
    await r.settings.update({ bufferMin: 15 })
    await r.settings.update({ sleepStart: '23:30' })
    const s = await r.settings.get()
    expect(s).toMatchObject({ bufferMin: 15, sleepStart: '23:30', dailyCapWeekday: DEFAULT_SETTINGS.dailyCapWeekday })
    expect(await db.settings.count()).toBe(1)
  })
})

describe('sessions, timer, check-ins, stats', () => {
  it('queries sessions by date (sorted) and inclusive range', async () => {
    await r.sessions.bulkPut([
      sessionRow({ date: '2026-11-24', start: '18:00' }),
      sessionRow({ date: '2026-11-24', start: '16:00' }),
      sessionRow({ date: '2026-11-25' }),
      sessionRow({ date: '2026-11-27' }),
    ])
    expect((await r.sessions.byDate('2026-11-24')).map((s) => s.start)).toEqual(['16:00', '18:00'])
    expect(await r.sessions.byRange('2026-11-24', '2026-11-25')).toHaveLength(3)
    expect(await r.sessions.byRange('2026-11-25', '2026-11-27')).toHaveLength(2)
  })

  it('keeps a single active timer row', async () => {
    expect(await r.activeTimer.get()).toBeUndefined()
    await r.activeTimer.set({ goalId: 'g', phase: 'work', phaseStartedAt: 1000, phaseLength: 25, cycle: 1, runStartedAt: 1000, config: { work: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLong: 4 }, targets: [] })
    await r.activeTimer.set({ goalId: 'g', phase: 'break', phaseStartedAt: 2000, phaseLength: 5, cycle: 1, runStartedAt: 1000, config: { work: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLong: 4 }, targets: [] })
    expect(await db.activeTimer.count()).toBe(1)
    expect(await r.activeTimer.get()).toMatchObject({ id: 'active', phase: 'break' })
    await r.activeTimer.clear()
    expect(await r.activeTimer.get()).toBeUndefined()
  })

  it('stores one check-in per day', async () => {
    await r.checkIns.put({ date: '2026-11-23', energy: 3, mood: 3 })
    await r.checkIns.put({ date: '2026-11-23', energy: 5, mood: 4, note: 'good day' })
    expect(await r.checkIns.all()).toEqual([{ date: '2026-11-23', energy: 5, mood: 4, note: 'good day' }])
  })

  it('stats are keyed by goal + time bucket', async () => {
    await r.stats.put({ goalId: 'g', bucket: 'morning', attempts: 1, completions: 1, focusMinutes: 30 })
    await r.stats.put({ goalId: 'g', bucket: 'morning', attempts: 2, completions: 1, focusMinutes: 60 })
    await r.stats.put({ goalId: 'g', bucket: 'evening', attempts: 1, completions: 0, focusMinutes: 0 })
    expect(await r.stats.byGoal('g')).toHaveLength(2)
    expect((await r.stats.get('g', 'morning'))!.attempts).toBe(2)
  })
})
