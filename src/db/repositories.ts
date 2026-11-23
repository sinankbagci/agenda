import type { EntityTable, Table } from 'dexie'
import { db as defaultDb, type AgendaDB } from './db'
import { DEFAULT_SETTINGS } from './defaults'
import type {
  ActiveTimer,
  BacklogList,
  CheckIn,
  EpochMs,
  ISODate,
  Settings,
  Stats,
  Topic,
  TimeBucket,
  WeeklyReview,
} from './types'

/** Omit that works across union types (e.g. Rule). */
export type NewRow<T> = T extends unknown ? Omit<T, 'id'> : never
export type Changes<T> = Partial<NewRow<T>>

export const newId = (): string => crypto.randomUUID()

/** Basic CRUD for tables keyed by a string `id`. */
function entityRepo<T extends { id: string }>(entityTable: EntityTable<T, 'id'>) {
  // Dexie's generic key types don't narrow for a generic T; every id here is a string.
  const table = entityTable as unknown as Table<T, string>
  return {
    all: (): Promise<T[]> => table.toArray(),
    get: (id: string): Promise<T | undefined> => table.get(id),
    async add(data: NewRow<T>): Promise<T> {
      const row = { ...data, id: newId() } as unknown as T
      await table.add(row)
      return row
    },
    /** Insert or replace a full row (keeps its id). */
    async put(row: T): Promise<T> {
      await table.put(row)
      return row
    },
    async update(id: string, changes: Changes<T>): Promise<void> {
      const n = await table.update(id, changes as never)
      if (n === 0) throw new Error(`${table.name}: no row with id ${id}`)
    },
    remove: (id: string): Promise<void> => table.delete(id),
  }
}

export function createRepos(db: AgendaDB) {
  const goals = {
    ...entityRepo(db.goals),
    async active() {
      return (await db.goals.toArray()).filter((g) => g.active)
    },
    /**
     * Delete a goal with its topics, learning stats and still-planned sessions.
     * History (done/partial/skipped sessions, focus intervals, log entries) is kept
     * so year-in-review totals stay correct.
     */
    async remove(id: string): Promise<void> {
      await db.transaction('rw', [db.goals, db.topics, db.stats, db.sessions], async () => {
        await db.topics.where('goalId').equals(id).delete()
        await db.stats.where('goalId').equals(id).delete()
        await db.sessions
          .where('goalId')
          .equals(id)
          .filter((s) => s.status === 'planned')
          .delete()
        await db.goals.delete(id)
      })
    },
  }

  const topics = {
    ...entityRepo(db.topics),
    /** Topics of a goal in their planned order. */
    byGoal: (goalId: string): Promise<Topic[]> =>
      db.topics.where('[goalId+order]').between([goalId, -Infinity], [goalId, Infinity]).toArray(),
    /** Append a topic at the end of the goal's list. */
    async append(data: Omit<NewRow<Topic>, 'order'>): Promise<Topic> {
      const existing = await topics.byGoal(data.goalId)
      const order = existing.length ? existing[existing.length - 1]!.order + 1 : 0
      return topics.add({ ...data, order })
    },
    /** Rewrite `order` to match the given id sequence. */
    async reorder(goalId: string, orderedIds: string[]): Promise<void> {
      await db.transaction('rw', db.topics, async () => {
        const own = new Set((await topics.byGoal(goalId)).map((t) => t.id))
        for (const [order, id] of orderedIds.entries()) {
          if (!own.has(id)) throw new Error(`topic ${id} does not belong to goal ${goalId}`)
          await db.topics.update(id, { order })
        }
      })
    },
  }

  const locations = {
    ...entityRepo(db.locations),
    /** Delete a location and every travel time that mentions it. */
    async remove(id: string): Promise<void> {
      await db.transaction('rw', [db.locations, db.travelTimes], async () => {
        await db.travelTimes.where('fromId').equals(id).delete()
        await db.travelTimes.where('toId').equals(id).delete()
        await db.locations.delete(id)
      })
    },
  }

  /** Travel times are symmetric: setting A→B also sets B→A. */
  const travelTimes = {
    all: () => db.travelTimes.toArray(),
    async get(fromId: string, toId: string): Promise<number | undefined> {
      if (fromId === toId) return 0
      return (await db.travelTimes.get([fromId, toId]))?.minutes
    },
    async set(fromId: string, toId: string, minutes: number): Promise<void> {
      if (fromId === toId) return
      await db.travelTimes.bulkPut([
        { fromId, toId, minutes },
        { fromId: toId, toId: fromId, minutes },
      ])
    },
    async remove(fromId: string, toId: string): Promise<void> {
      await db.travelTimes.bulkDelete([
        [fromId, toId],
        [toId, fromId],
      ])
    },
  }

  /** Single-row settings, always returned complete (missing fields fall back to defaults). */
  const settings = {
    async get(): Promise<Settings> {
      return { ...DEFAULT_SETTINGS, ...(await db.settings.get('settings')) }
    },
    async update(changes: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
      const next = { ...(await settings.get()), ...changes, id: 'settings' as const }
      await db.settings.put(next)
      return next
    },
  }

  const sessions = {
    ...entityRepo(db.sessions),
    byDate: (date: ISODate) => db.sessions.where('date').equals(date).sortBy('start'),
    /** Inclusive date range. */
    byRange: (from: ISODate, to: ISODate) => db.sessions.where('date').between(from, to, true, true).toArray(),
    byGoal: (goalId: string) => db.sessions.where('goalId').equals(goalId).toArray(),
    bulkPut: (rows: Parameters<typeof db.sessions.bulkPut>[0]) => db.sessions.bulkPut(rows),
  }

  const focusIntervals = {
    ...entityRepo(db.focusIntervals),
    byGoal: (goalId: string) => db.focusIntervals.where('goalId').equals(goalId).toArray(),
    bySession: (sessionId: string) => db.focusIntervals.where('sessionId').equals(sessionId).toArray(),
    /** Intervals that started in [from, to). */
    startedBetween: (from: EpochMs, to: EpochMs) =>
      db.focusIntervals.where('startedAt').between(from, to, true, false).toArray(),
  }

  /** The one running focus timer, persisted so it survives the app being closed. */
  const activeTimer = {
    get: () => db.activeTimer.get('active'),
    async set(timer: Omit<ActiveTimer, 'id'>): Promise<ActiveTimer> {
      const row: ActiveTimer = { ...timer, id: 'active' }
      await db.activeTimer.put(row)
      return row
    },
    clear: () => db.activeTimer.delete('active'),
  }

  const logEntries = {
    ...entityRepo(db.logEntries),
    byRange: (from: ISODate, to: ISODate) => db.logEntries.where('date').between(from, to, true, true).toArray(),
    byGoal: (goalId: string) => db.logEntries.where('goalId').equals(goalId).toArray(),
  }

  /** One check-in per day; saving again replaces it. */
  const checkIns = {
    all: () => db.checkIns.toArray(),
    get: (date: ISODate) => db.checkIns.get(date),
    put: async (c: CheckIn) => {
      await db.checkIns.put(c)
      return c
    },
    byRange: (from: ISODate, to: ISODate) => db.checkIns.where('date').between(from, to, true, true).toArray(),
    remove: (date: ISODate) => db.checkIns.delete(date),
  }

  const backlogItems = {
    ...entityRepo(db.backlogItems),
    byList: (list: BacklogList) => db.backlogItems.where('list').equals(list).toArray(),
  }

  const weeklyReviews = {
    all: () => db.weeklyReviews.toArray(),
    get: (weekStart: ISODate) => db.weeklyReviews.get(weekStart),
    put: async (r: WeeklyReview) => {
      await db.weeklyReviews.put(r)
      return r
    },
  }

  const stats = {
    all: () => db.stats.toArray(),
    get: (goalId: string, bucket: TimeBucket) => db.stats.get([goalId, bucket]),
    byGoal: (goalId: string) => db.stats.where('goalId').equals(goalId).toArray(),
    put: async (s: Stats) => {
      await db.stats.put(s)
      return s
    },
  }

  return {
    goals,
    topics,
    fixedBlocks: entityRepo(db.fixedBlocks),
    availabilityWindows: {
      ...entityRepo(db.availabilityWindows),
      byWeekday: (weekday: number) => db.availabilityWindows.where('weekday').equals(weekday).sortBy('start'),
    },
    availabilityOverrides: {
      ...entityRepo(db.availabilityOverrides),
      byDate: (date: ISODate) => db.availabilityOverrides.where('date').equals(date).toArray(),
    },
    mealRules: entityRepo(db.mealRules),
    locations,
    travelTimes,
    rules: entityRepo(db.rules),
    settings,
    sessions,
    focusIntervals,
    activeTimer,
    logEntries,
    checkIns,
    backlogItems,
    weeklyReviews,
    stats,
  }
}

export type Repos = ReturnType<typeof createRepos>

/** App-wide repositories bound to the real database. */
export const repos = createRepos(defaultDb)
