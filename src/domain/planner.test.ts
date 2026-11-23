import { describe, expect, it } from 'vitest'
import { addDays, format, parseISO } from 'date-fns'
import { plan, type PlanState } from './planner'
import { buildDay } from './freeSlots'
import { toMinutes } from './time'
import type { Goal, Session } from '../db/types'
import { TODAY, midterm, reading, scenarioState, workout } from '../test/scenario'

const mins = (s: Pick<Session, 'start' | 'end'>) => toMinutes(s.end) - toMinutes(s.start)
const goalSessions = (ss: Session[], goalId: string, kind: Session['kind'] = 'goal') => ss.filter((s) => s.goalId === goalId && s.kind === kind)
const sum = (ss: Session[]) => ss.reduce((m, s) => m + mins(s), 0)
const dayAfter = (d: string, n = 1) => format(addDays(parseISO(d), n), 'yyyy-MM-dd')
const byDate = (ss: Session[]) => {
  const m = new Map<string, Session[]>()
  for (const s of ss) m.set(s.date, [...(m.get(s.date) ?? []), s])
  return m
}
const session = (over: Partial<Session>): Session => ({
  id: crypto.randomUUID(),
  kind: 'goal',
  date: TODAY,
  start: '16:00',
  end: '17:00',
  status: 'planned',
  frozen: false,
  ...over,
})

describe('acceptance scenario (SPEC §7)', () => {
  const state = scenarioState()
  const result = plan(state, TODAY)
  const { sessions } = result

  it('plans from today through at least 6 weeks', () => {
    expect(result.from).toBe(TODAY)
    expect(result.to).toBe('2027-01-03') // 42 days
  })

  it('hits the 15h before Dec 11, with Dec 11 as the review day', () => {
    const study = goalSessions(sessions, 'midterm')
    expect(study.every((s) => s.date <= '2026-12-10')).toBe(true)
    expect(sum(study)).toBeGreaterThanOrEqual(15 * 60)
    expect(sum(study)).toBeLessThan(15 * 60 + midterm.minSession)
    const reviews = goalSessions(sessions, 'midterm', 'review')
    expect(reviews.map((r) => r.date)).toEqual(['2026-12-11'])
    expect(sessions.some((s) => s.goalId === 'midterm' && s.date >= '2026-12-12')).toBe(false)
  })

  it('increases study slightly toward the date (ramp)', () => {
    const perDay = [...byDate(goalSessions(sessions, 'midterm')).entries()].map(([d, ss]) => [d, sum(ss)] as const)
    const first = perDay.filter(([d]) => d <= '2026-11-27').map(([, m]) => m)
    const last = perDay.filter(([d]) => d >= '2026-12-07').map(([, m]) => m)
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(avg(last)).toBeGreaterThan(avg(first))
    expect(avg(last) / avg(first)).toBeLessThan(1.7) // gentle: weights 1.0 → 1.5
    expect(perDay.length).toBe(14) // every weekday from today, none skipped
  })

  it('keeps workouts on non-consecutive days with travel to the gym inserted', () => {
    const w = goalSessions(sessions, 'workout')
    const dates = w.map((s) => s.date)
    for (let i = 1; i < dates.length; i++) expect(dates[i]! > dayAfter(dates[i - 1]!)).toBe(true)
    for (const s of w) {
      const sameDay = sessions.filter((x) => x.date === s.date && x.kind === 'travel')
      expect(sameDay.some((t) => t.fromLocationId === 'home' && t.toLocationId === 'gym' && t.end === s.start)).toBe(true)
      expect(sameDay.some((t) => t.fromLocationId === 'gym' && t.toLocationId === 'home' && t.start === s.end)).toBe(true)
      expect(s.locationId).toBe('gym')
    }
    // weekdays only have free time, so with rest days 3 per week is the honest maximum — and it says so
    const warning = result.warnings.find((x) => x.kind === 'recurringShortfall')!
    expect(warning.message).toBe('“Workout”: only 3 of 4 sessions a week fit in 6 of the coming weeks (with rest days between).')
    expect(dates.filter((d) => d >= '2026-11-23' && d <= '2026-11-29')).toEqual(['2026-11-23', '2026-11-25', '2026-11-27'])
  })

  it('never schedules during class, dinner, sleep or travel, and nothing overlaps', () => {
    for (const [date, ss] of byDate(sessions)) {
      const layout = buildDay(state.setup, date)
      const fixedAndSleep = layout.blocks.filter((b) => b.kind === 'fixed' || b.kind === 'sleep')
      const sorted = [...ss].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
      for (const s of sorted) {
        const r = { start: toMinutes(s.start), end: toMinutes(s.end) }
        for (const b of fixedAndSleep) expect(r.start < b.end && b.start < r.end, `${date} ${s.kind} ${s.start} vs ${b.kind}`).toBe(false)
      }
      for (let i = 1; i < sorted.length; i++) {
        expect(toMinutes(sorted[i]!.start) >= toMinutes(sorted[i - 1]!.end), `${date} overlap at ${sorted[i]!.start}`).toBe(true)
      }
    }
  })

  it('leaves the buffer between goal sessions and other items', () => {
    for (const ss of byDate(sessions).values()) {
      const goalish = ss.filter((s) => s.kind === 'goal' || s.kind === 'review')
      for (const g of goalish) {
        for (const o of ss) {
          if (o === g) continue
          const travelOfThis = o.kind === 'travel' && (o.end === g.start || o.start === g.end) && g.locationId
          if (travelOfThis) continue
          const gap = Math.max(toMinutes(o.start) - toMinutes(g.end), toMinutes(g.start) - toMinutes(o.end))
          expect(gap, `${g.date} ${g.goalId} ${g.start} vs ${o.kind} ${o.start}`).toBeGreaterThanOrEqual(10)
        }
      }
    }
  })

  it('stays within daily caps', () => {
    for (const [date, ss] of byDate(sessions)) {
      const goalMin = sum(ss.filter((s) => s.kind === 'goal' || s.kind === 'review'))
      const demanding = sum(ss.filter((s) => s.goalId === 'midterm'))
      const weekend = [0, 6].includes(parseISO(date).getDay())
      expect(goalMin).toBeLessThanOrEqual(weekend ? 240 : 360)
      expect(demanding).toBeLessThanOrEqual(240)
    }
  })

  it('reads 30 minutes every weekday and reports the weekends it cannot', () => {
    for (const [date, ss] of byDate(sessions)) {
      const weekend = [0, 6].includes(parseISO(date).getDay())
      expect(sum(goalSessions(ss, 'reading')), date).toBe(weekend ? 0 : 30)
    }
    expect(result.warnings.find((w) => w.kind === 'ongoingShortfall')!.message).toBe('“Reading” gets less than 30m on 12 days.')
  })

  it('puts demanding study into high-energy time', () => {
    for (const s of goalSessions(sessions, 'midterm')) expect(toMinutes(s.start)).toBeGreaterThanOrEqual(16 * 60)
    for (const s of goalSessions(sessions, 'midterm')) expect(toMinutes(s.end)).toBeLessThanOrEqual(19 * 60)
  })

  it('includes meals and the daily travel so the timeline is complete', () => {
    const mon = sessions.filter((s) => s.date === TODAY && (s.kind === 'meal' || s.kind === 'travel'))
    expect(mon.map((s) => `${s.kind} ${s.start}–${s.end}${s.label ? ' ' + s.label : ''}`)).toContain('meal 19:00–19:45 Dinner')
    expect(mon.some((s) => s.kind === 'travel' && s.start === '08:40' && s.toLocationId === 'campus')).toBe(true)
  })

  it('uses 5-minute lengths within the goal’s session limits', () => {
    for (const s of sessions.filter((x) => x.kind === 'goal' || x.kind === 'review')) {
      const g = state.goals.find((x) => x.id === s.goalId)!
      expect(mins(s) % 5).toBe(0)
      expect(mins(s)).toBeGreaterThanOrEqual(g.minSession)
      expect(mins(s)).toBeLessThanOrEqual(g.maxSession)
    }
  })

  it('is deterministic, has stable unique ids and does not mutate its input', () => {
    const s2 = scenarioState()
    const copy = structuredClone(s2)
    const a = plan(s2, TODAY)
    expect(a).toEqual(plan(s2, TODAY))
    expect(s2).toEqual(copy)
    expect(new Set(a.sessions.map((s) => s.id)).size).toBe(a.sessions.length)
    expect(a.sessions[0]!.id).toMatch(/^plan:2026-11-23:/)
  })
})

const withGoals = (goals: Goal[], over: Partial<PlanState> = {}) => scenarioState({ goals, ...over })
const weekendToo = (state: PlanState): PlanState => ({
  ...state,
  setup: {
    ...state.setup,
    availabilityWindows: [
      ...state.setup.availabilityWindows,
      ...([6, 0] as const).map((d) => ({ id: `we${d}`, weekday: d, start: '10:00', end: '18:00', energy: 'normal' as const })),
    ],
  },
})

describe('progress and kept sessions', () => {
  it('done sessions reduce what is left; skipped ones return to the pool', () => {
    const done = [
      session({ goalId: 'midterm', date: '2026-11-20', start: '16:00', end: '21:00', status: 'done' }), // 300 min
      session({ goalId: 'midterm', date: '2026-11-21', status: 'partial', actualMinutes: 40 }),
      session({ goalId: 'midterm', date: '2026-11-22', status: 'skipped' }),
      session({ goalId: 'midterm', date: '2026-11-19', status: 'planned' }), // missed: counts nothing
    ]
    const r = plan(withGoals([midterm], { sessions: done }), TODAY)
    const planned = sum(goalSessions(r.sessions, 'midterm'))
    expect(planned).toBeGreaterThanOrEqual(900 - 340)
    expect(planned).toBeLessThan(900 - 340 + 45)
  })

  it('done minutes use actualMinutes when logged', () => {
    const done = [session({ goalId: 'midterm', date: '2026-11-20', start: '16:00', end: '17:00', status: 'done', actualMinutes: 90 })]
    const planned = sum(goalSessions(plan(withGoals([midterm], { sessions: done }), TODAY).sessions, 'midterm'))
    expect(planned).toBeGreaterThanOrEqual(810)
    expect(planned).toBeLessThan(855)
  })

  it('keeps today frozen when planning from tomorrow, and counts today’s planned work', () => {
    const todays = [session({ goalId: 'midterm', date: TODAY, start: '16:00', end: '18:00', frozen: true })]
    const r = plan(withGoals([midterm], { sessions: todays }), TODAY, { from: '2026-11-24' })
    expect(r.from).toBe('2026-11-24')
    expect(r.sessions.some((s) => s.date === TODAY)).toBe(false)
    const planned = sum(goalSessions(r.sessions, 'midterm'))
    expect(planned).toBeGreaterThanOrEqual(780)
    expect(planned).toBeLessThan(825)
  })

  it('notBefore: re-planning today in the evening only uses time after now', () => {
    const r = plan(withGoals([midterm, reading]), TODAY, { notBefore: 18 * 60 })
    for (const x of r.sessions.filter((x) => x.date === TODAY && (x.kind === 'goal' || x.kind === 'travel') && x.goalId)) {
      expect(toMinutes(x.start)).toBeGreaterThanOrEqual(18 * 60)
    }
    expect(r.sessions.some((x) => x.date === '2026-11-24' && toMinutes(x.start) === 16 * 60)).toBe(true) // tomorrow untouched
  })

  it('a goal skipped on a day gets nothing new that day, even when re-planning today', () => {
    const skipped = [session({ goalId: 'workout', date: TODAY, start: '20:10', end: '20:55', status: 'skipped', locationId: 'gym' })]
    const r = plan(withGoals([workout], { sessions: skipped }), TODAY, { notBefore: 16 * 60 + 30 })
    expect(goalSessions(r.sessions, 'workout').some((s) => s.date === TODAY)).toBe(false)
    expect(goalSessions(r.sessions, 'workout').some((s) => s.date === '2026-11-24')).toBe(true) // made up later in the week
  })

  it('re-planning today after finishing today’s share adds no more of that goal today', () => {
    const done = [session({ goalId: 'midterm', date: TODAY, start: '16:00', end: '16:55', status: 'done', actualMinutes: 55 })]
    const r = plan(withGoals([midterm], { sessions: done }), TODAY, { notBefore: 17 * 60 })
    expect(goalSessions(r.sessions, 'midterm').some((s) => s.date === TODAY)).toBe(false)
    const total = sum(goalSessions(r.sessions, 'midterm'))
    expect(total).toBeGreaterThanOrEqual(900 - 55)
    expect(total).toBeLessThan(900 - 55 + 45)
  })

  it('never plans over a session that is done or in progress', () => {
    const kept = [session({ goalId: 'reading', date: TODAY, start: '16:00', end: '18:00', status: 'done' })]
    const r = plan(withGoals([midterm], { sessions: kept }), TODAY)
    for (const s of r.sessions.filter((x) => x.date === TODAY && x.kind !== 'travel' && x.kind !== 'meal')) {
      expect(toMinutes(s.start) >= 18 * 60 + 10 || toMinutes(s.end) <= 16 * 60 - 10).toBe(true)
    }
  })

  it('ignores paused goals and deadlines that have passed', () => {
    const r = plan(withGoals([{ ...midterm, active: false }, { ...reading, id: 'old', type: 'deadline', deadline: '2026-11-20', totalHours: 5 }]), TODAY)
    expect(r.sessions.some((s) => s.kind === 'goal' || s.kind === 'review')).toBe(false)
  })
})

describe('overload', () => {
  it('raises a deadline shortfall with concrete options', () => {
    const big = { ...midterm, totalHours: 60 }
    const r = plan(withGoals([big, reading]), TODAY)
    const w = r.warnings.find((x) => x.kind === 'deadlineShortfall')
    expect(w).toBeDefined()
    if (w?.kind !== 'deadlineShortfall') return
    const planned = sum(goalSessions(r.sessions, 'midterm'))
    expect(w.shortfallMinutes).toBe(3600 - planned)
    expect(w.message).toMatch(/^“Algebra midterm”: \d+h( \d+m)? of 60h doesn’t fit before Fri 11 Dec\.$/)
    // Reading is planned after deadline goals, so pausing it would free nothing: not suggested.
    expect(w.options.map((o) => o.kind)).toEqual(['addFreeTime', 'reduceHours', 'acceptShortfall'])
    expect(w.options[0]).toEqual({ kind: 'addFreeTime', before: '2026-12-11' })
    const reduce = w.options[1]
    expect(reduce?.kind === 'reduceHours' && reduce.toHours * 60 <= planned).toBe(true)
  })

  it('the demanding cap limits a demanding goal per day', () => {
    const r = plan(withGoals([{ ...midterm, totalHours: 60, maxSession: 120 }], { caps: { dailyCapWeekday: 6, dailyCapWeekend: 4, demandingCap: 2 } }), TODAY)
    for (const ss of byDate(goalSessions(r.sessions, 'midterm')).values()) expect(sum(ss)).toBeLessThanOrEqual(120)
  })

  it('when two deadlines compete, the more urgent × higher priority goal gets its hours', () => {
    const a = { ...midterm, id: 'a', name: 'A', totalHours: 40, priority: 3 as const }
    const b = { ...midterm, id: 'b', name: 'B', totalHours: 40, priority: 1 as const }
    const r = plan(withGoals([b, a]), TODAY)
    const short = r.warnings.filter((w) => w.kind === 'deadlineShortfall').map((w) => (w.kind === 'deadlineShortfall' ? w.goalId : ''))
    expect(short).toEqual(['b'])
    expect(sum(goalSessions(r.sessions, 'a'))).toBeGreaterThanOrEqual(40 * 60)
    // ...and B's warning suggests pausing / lowering A, which took the time
    const wb = r.warnings.find((w) => w.kind === 'deadlineShortfall')
    expect(wb?.kind === 'deadlineShortfall' && wb.options.find((o) => o.kind === 'pauseGoal')).toEqual({ kind: 'pauseGoal', goalId: 'a', name: 'A' })
  })
})

describe('rules and preferences', () => {
  it('applies category rules per goal (no Study after 18:00)', () => {
    const state = withGoals([midterm, reading])
    state.setup = { ...state.setup, rules: [{ id: 'r', kind: 'noGoalAfter', params: { time: '18:00', category: 'Study' } }] }
    const r = plan(state, TODAY)
    for (const s of goalSessions(r.sessions, 'midterm')) expect(toMinutes(s.end)).toBeLessThanOrEqual(18 * 60)
    expect(goalSessions(r.sessions, 'reading').some((s) => toMinutes(s.end) > 18 * 60)).toBe(true) // other categories unaffected
  })

  it('honours the preferred time of day', () => {
    const r = plan(withGoals([{ ...reading, preferredTime: 'afternoon' }]), TODAY)
    for (const s of goalSessions(r.sessions, 'reading')) expect(toMinutes(s.start)).toBeLessThan(17 * 60)
  })
})

describe('recurring goals', () => {
  it('with rest days, 4 a week fits only every other week (Sunday → Monday is back-to-back)', () => {
    const r = plan(weekendToo(withGoals([workout])), TODAY)
    const dates = [...byDate(goalSessions(r.sessions, 'workout')).keys()]
    expect(dates.filter((d) => d <= '2026-11-29')).toEqual(['2026-11-23', '2026-11-25', '2026-11-27', '2026-11-29'])
    expect(dates.filter((d) => d >= '2026-11-30' && d <= '2026-12-06')).toEqual(['2026-12-01', '2026-12-03', '2026-12-05'])
    for (let i = 1; i < dates.length; i++) expect(dates[i]! > dayAfter(dates[i - 1]!)).toBe(true)
    const w = r.warnings.find((x) => x.kind === 'recurringShortfall')
    expect(w?.kind === 'recurringShortfall' && w.weeks.map((x) => x.weekStart)).toEqual(['2026-11-30', '2026-12-14', '2026-12-28'])
  })

  it('3 a week with rest days fits every week when weekends are free', () => {
    const r = plan(weekendToo(withGoals([{ ...workout, perWeek: 3 }])), TODAY)
    expect(r.warnings.filter((w) => w.kind === 'recurringShortfall')).toEqual([])
    const dates = [...byDate(goalSessions(r.sessions, 'workout')).keys()]
    expect(dates.length).toBe(18) // 3 × 6 weeks
    for (let i = 1; i < dates.length; i++) expect(dates[i]! > dayAfter(dates[i - 1]!)).toBe(true)
  })

  it('without the rest rule it can use back-to-back days', () => {
    const r = plan(withGoals([{ ...workout, perWeek: 5, noConsecutiveDays: false }]), TODAY)
    expect([...byDate(goalSessions(r.sessions, 'workout')).keys()].filter((d) => d <= '2026-11-29')).toHaveLength(5)
  })

  it('a session missed earlier in the week is made up later that week', () => {
    const wed = '2026-11-25'
    const missed = [session({ goalId: 'workout', date: TODAY, status: 'skipped', locationId: 'gym' })]
    const r = plan(withGoals([{ ...workout, perWeek: 3, noConsecutiveDays: false }], { sessions: missed }), wed)
    expect([...byDate(goalSessions(r.sessions, 'workout')).keys()].filter((d) => d <= '2026-11-29')).toEqual(['2026-11-25', '2026-11-26', '2026-11-27'])
  })

  it('counts sessions already done this week', () => {
    const done = [session({ goalId: 'workout', date: TODAY, status: 'done' })]
    const r = plan(weekendToo(withGoals([workout], { sessions: done })), '2026-11-24')
    const thisWeek = [...byDate(goalSessions(r.sessions, 'workout')).keys()].filter((d) => d <= '2026-11-29')
    expect(thisWeek).toHaveLength(3)
    expect(thisWeek).not.toContain('2026-11-24') // day after a done session: rest day
  })
})

describe('ongoing and book goals', () => {
  it('a weekly target is spread over the week', () => {
    const lang = { ...reading, id: 'lang', name: 'Spanish', minutesPerDay: undefined, minutesPerWeek: 150, minSession: 20, maxSession: 45 }
    const r = plan(withGoals([lang]), TODAY)
    const week = goalSessions(r.sessions, 'lang').filter((s) => s.date <= '2026-11-29')
    expect(sum(week)).toBeGreaterThanOrEqual(150)
    expect(sum(week)).toBeLessThan(150 + 20)
    expect(new Set(week.map((s) => s.date)).size).toBeGreaterThanOrEqual(3)
  })

  it('respects an end date', () => {
    const r = plan(withGoals([{ ...reading, endDate: '2026-11-25' }]), TODAY)
    expect(goalSessions(r.sessions, 'reading').map((s) => s.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25'])
  })

  it('plans daily reading for an unfinished book and nothing for a finished one', () => {
    const book: Goal = { ...reading, id: 'dune', type: 'book', name: 'Dune', totalPages: 412, pagesDone: 100, deadline: '2027-03-01' }
    const r = plan(withGoals([book, { ...book, id: 'done', pagesDone: 412 }]), TODAY)
    expect(goalSessions(r.sessions, 'dune').length).toBeGreaterThan(0)
    expect(goalSessions(r.sessions, 'done')).toEqual([])
    expect(r.to).toBe('2027-03-01') // horizon reaches the book's target date
  })
})

describe('travel and setup warnings', () => {
  it('warns when a goal’s place has no travel time', () => {
    const r = plan(withGoals([{ ...workout, locationId: 'pool' }]), TODAY)
    expect(r.warnings.find((w) => w.kind === 'goalTravelUnknown')?.message).toBe('No travel time set to the place of “Workout”; assuming 0 min.')
  })

  it('groups the same setup problem across days into one warning', () => {
    const state = withGoals([])
    state.setup = { ...state.setup, mealRules: [{ id: 'l', name: 'Lunch', windowStart: '12:00', windowEnd: '14:00', duration: 30 }] }
    const setup = plan(state, TODAY).warnings.filter((w) => w.kind === 'setup')
    expect(setup).toHaveLength(1)
    expect(setup[0]!.kind === 'setup' && setup[0]!.dates.length).toBe(30) // every weekday in 6 weeks
  })
})

describe('one-off additions (+ Add)', () => {
  const SAT = '2026-11-28'
  const SUN = '2026-11-29'
  const extra = (state: PlanState, boostGoalIds?: string[], energy: 'high' | 'normal' = 'high'): PlanState => ({
    ...state,
    setup: {
      ...state.setup,
      availabilityOverrides: [SAT, SUN].map((date, i) => ({ id: `x${i}`, date, kind: 'free' as const, start: '10:00', end: '18:00', energy, ...(boostGoalIds ? { boostGoalIds } : {}) })),
    },
  })

  it('a one-off event (tennis Fri 13:00–15:00 at a club) is planned around, with travel', () => {
    const state = withGoals([midterm, reading])
    state.setup = {
      ...state.setup,
      availabilityWindows: [...state.setup.availabilityWindows, { id: 'fri', weekday: 5, start: '15:20', end: '16:00', energy: 'normal' }],
      locations: [...state.setup.locations, { id: 'club', name: 'Tennis club' }],
      travelTimes: [...state.setup.travelTimes, { fromId: 'home', toId: 'club', minutes: 10 }],
      fixedBlocks: [{ id: 't', title: 'Tennis', rule: { kind: 'once', date: '2026-11-28' }, start: '13:00', end: '15:00', locationId: 'club', locked: true }],
    }
    const r = plan(state, TODAY)
    const sat = r.sessions.filter((s) => s.date === '2026-11-28')
    expect(sat.some((s) => s.kind === 'travel' && s.toLocationId === 'club' && s.end === '13:00')).toBe(true)
    expect(sat.some((s) => s.kind === 'travel' && s.fromLocationId === 'club' && s.start === '15:00')).toBe(true)
  })

  it('a pinned goal session stays put, counts toward the goal, and others plan around it', () => {
    const pinned = session({ id: 'pin', goalId: 'midterm', date: SAT, start: '10:00', end: '12:00', frozen: true, pinned: true })
    const r2 = plan(extra(withGoals([midterm], { sessions: [pinned] })), TODAY)
    expect(r2.sessions.some((s) => s.id === 'pin')).toBe(false) // not re-emitted: it's stored, not planned
    const plannedPlusPinned = sum(goalSessions(r2.sessions, 'midterm')) + 120
    expect(plannedPlusPinned).toBeGreaterThanOrEqual(900) // the pinned 2h count toward the 15h
    expect(plannedPlusPinned).toBeLessThan(900 + 45)
    for (const s of r2.sessions.filter((x) => x.date === SAT && x.goalId)) expect(s.start >= '12:10' || s.end <= '09:50').toBe(true)
  })

  it('extra free time without “use it for” is simply more room, with its own energy', () => {
    const r = plan(extra(withGoals([midterm, reading])), TODAY)
    expect(goalSessions(r.sessions, 'reading').filter((s) => s.date === SAT).map(mins)).toEqual([30]) // target only
    expect(sum(goalSessions(r.sessions, 'midterm'))).toBeGreaterThanOrEqual(900)
    expect(goalSessions(r.sessions, 'midterm').some((s) => s.date === SAT)).toBe(true) // weekend now takes a ramp share
  })

  it('“use it for” a deadline goal pulls work into the weekend and lightens the weekdays', () => {
    const plain = plan(extra(withGoals([midterm])), TODAY)
    const boosted = plan(extra(withGoals([midterm]), ['midterm']), TODAY)
    const weekend = (ss: Session[]) => sum(goalSessions(ss, 'midterm').filter((s) => s.date === SAT || s.date === SUN))
    const weekdays = (ss: Session[]) => sum(goalSessions(ss, 'midterm').filter((s) => s.date !== SAT && s.date !== SUN))
    expect(weekend(boosted.sessions)).toBe(2 * 240) // up to the 4h weekend cap each day
    expect(weekdays(boosted.sessions)).toBeLessThan(weekdays(plain.sessions))
    const total = sum(goalSessions(boosted.sessions, 'midterm'))
    expect(total).toBeGreaterThanOrEqual(900)
    expect(total).toBeLessThan(900 + 45)
    for (const s of goalSessions(boosted.sessions, 'midterm').filter((x) => x.date === SAT)) {
      expect(s.start >= '10:00' && s.end <= '18:00').toBe(true)
    }
  })

  it('“use it for” reading lets it go beyond its 30 min target, within the daily cap', () => {
    const r = plan(extra(withGoals([reading, midterm]), ['reading']), TODAY)
    const sat = goalSessions(r.sessions, 'reading').filter((s) => s.date === SAT)
    expect(sum(sat)).toBeGreaterThan(30)
    const satWork = r.sessions.filter((s) => s.date === SAT && (s.kind === 'goal' || s.kind === 'review'))
    expect(sum(satWork)).toBeLessThanOrEqual(240)
    for (const s of sat) expect(s.start >= '10:00' && s.end <= '18:00').toBe(true)
  })

  it('a deadline goal and reading chosen together share the extra day fairly', () => {
    const r = plan(extra(withGoals([midterm, reading]), ['midterm', 'reading']), TODAY)
    const mid = sum(goalSessions(r.sessions, 'midterm').filter((s) => s.date === SAT))
    const read = sum(goalSessions(r.sessions, 'reading').filter((s) => s.date === SAT))
    // the midterm takes at most half of the 4h weekend cap (in whole sessions: 90 of 120 min,
    // since 30 left is under its 45 min minimum); reading gets the rest, beyond its 30 min target
    expect(mid).toBeGreaterThanOrEqual(90)
    expect(mid).toBeLessThanOrEqual(120)
    expect(read).toBeGreaterThanOrEqual(120)
    expect(mid + read).toBe(240)
  })

  it('“use it for” shares the time between several goals', () => {
    const lang = { ...reading, id: 'lang', name: 'Spanish' }
    const r = plan(extra(withGoals([reading, lang]), ['reading', 'lang']), TODAY)
    const a = sum(goalSessions(r.sessions, 'reading').filter((s) => s.date === SAT))
    const b = sum(goalSessions(r.sessions, 'lang').filter((s) => s.date === SAT))
    expect(a + b).toBe(240)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(30)
  })
})
