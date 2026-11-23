/**
 * Runs the pure planner against the database and saves the result.
 * The only impure part of planning: reads all inputs, calls `plan`, replaces the
 * regenerated planned sessions in one transaction.
 */
import { addDays, format } from 'date-fns'
import { db as defaultDb, type AgendaDB } from './db'
import { createRepos } from './repositories'
import { plan, type PlanResult, type PlanState, type PlanWarning } from '../domain/planner'
import type { ISODate, Session } from './types'
import { toMinutes } from '../domain/time'

export async function loadPlanState(db: AgendaDB = defaultDb): Promise<PlanState> {
  const r = createRepos(db)
  const [settings, fixedBlocks, availabilityWindows, availabilityOverrides, mealRules, locations, travelTimes, rules, goals, sessions] =
    await Promise.all([
      r.settings.get(),
      r.fixedBlocks.all(),
      r.availabilityWindows.all(),
      r.availabilityOverrides.all(),
      r.mealRules.all(),
      r.locations.all(),
      r.travelTimes.all(),
      r.rules.all(),
      r.goals.all(),
      r.sessions.all(),
    ])
  return {
    setup: { settings, fixedBlocks, availabilityWindows, availabilityOverrides, mealRules, locations, travelTimes, rules },
    caps: settings,
    goals,
    sessions,
  }
}

export interface ReplanOptions {
  /**
   * Regenerate today too ("Re-plan today"). Otherwise today is frozen once it has a plan:
   * only tomorrow onwards is regenerated (SPEC 3.1).
   */
  includeToday?: boolean
}

/** Plan and save. Done / partial / skipped / frozen sessions are never touched. */
export async function replan(now: Date, options: ReplanOptions = {}, db: AgendaDB = defaultDb): Promise<PlanResult> {
  const today: ISODate = format(now, 'yyyy-MM-dd')
  const tomorrow: ISODate = format(addDays(now, 1), 'yyyy-MM-dd')

  return db.transaction('rw', [db.sessions, db.meta, ...relatedTables(db)], async () => {
    const state = await loadPlanState(db)
    // Today is frozen once it has goal work planned. A day with only meals/travel (e.g. while
    // onboarding, before any goal exists) is still re-planned, so new goals show up today.
    const todayHasPlan = state.sessions.some((s) => s.date === today && (s.kind === 'goal' || s.kind === 'review'))
    const from = options.includeToday || !todayHasPlan ? today : tomorrow
    const nowMin = now.getHours() * 60 + now.getMinutes()

    // Repair: earlier versions could save the same planned meal / travel block several times
    // (see below). Keep one of each.
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const s of [...state.sessions].sort((a, b) => a.id.localeCompare(b.id))) {
      if (s.status !== 'planned' || (s.kind !== 'meal' && s.kind !== 'travel')) continue
      const k = blockKey(s)
      if (seen.has(k)) duplicates.push(s.id)
      else seen.add(k)
    }
    if (duplicates.length) {
      await db.sessions.bulkDelete(duplicates)
      const gone = new Set(duplicates)
      state.sessions = state.sessions.filter((s) => !gone.has(s.id))
    }

    // Re-planning today: goal work that already started stays where it is (in progress, or
    // missed); new work only goes after now. Meals and travel are NOT frozen — the planner
    // regenerates them, and freezing them is what duplicated them.
    if (from === today) {
      const started = state.sessions.filter(
        (s) => s.date === today && s.status === 'planned' && !s.frozen && (s.kind === 'goal' || s.kind === 'review') && toMinutes(s.start) < nowMin,
      )
      for (const s of started) s.frozen = true
      if (started.length) await db.sessions.bulkPut(started)
    }
    const result = plan(state, today, { from, notBefore: from === today ? nowMin : undefined })

    const stale = state.sessions.filter((s) => s.date >= from && s.status === 'planned' && !s.frozen).map((s) => s.id)
    await db.sessions.bulkDelete(stale)
    await db.sessions.bulkPut(result.sessions)
    await db.meta.bulkPut([
      { key: 'planWarnings', value: JSON.stringify(result.warnings) },
      { key: 'plannedAt', value: String(now.getTime()) },
    ])
    return result
  })
}

/** Warnings from the last re-plan (shown on Today in step 7). */
export async function lastPlanWarnings(db: AgendaDB = defaultDb): Promise<PlanWarning[]> {
  const row = await db.meta.get('planWarnings')
  return row ? (JSON.parse(row.value) as PlanWarning[]) : []
}

/** Identity of a meal / travel block on a day. */
const blockKey = (s: Session) => [s.date, s.kind, s.start, s.end, s.mealId ?? s.label ?? '', s.fromLocationId ?? '', s.toLocationId ?? ''].join('|')

const relatedTables = (db: AgendaDB) => [
  db.settings,
  db.fixedBlocks,
  db.availabilityWindows,
  db.availabilityOverrides,
  db.mealRules,
  db.locations,
  db.travelTimes,
  db.rules,
  db.goals,
]
