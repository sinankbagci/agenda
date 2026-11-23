/** SPEC §7 acceptance scenario, shared by planner tests. Today = Mon 23 Nov 2026. */
import type { Goal, Weekday } from '../db/types'
import type { PlanState } from '../domain/planner'
import type { SlotInput } from '../domain/freeSlots'

export const TODAY = '2026-11-23'
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5]

export function scenarioSetup(): SlotInput {
  return {
    settings: { sleepStart: '00:00', sleepEnd: '08:00', bufferMin: 10, homeLocationId: 'home' },
    locations: [
      { id: 'home', name: 'Home' },
      { id: 'campus', name: 'Campus' },
      { id: 'gym', name: 'Gym' },
    ],
    travelTimes: [
      { fromId: 'home', toId: 'campus', minutes: 20 },
      { fromId: 'campus', toId: 'home', minutes: 20 },
      { fromId: 'home', toId: 'gym', minutes: 15 },
      { fromId: 'gym', toId: 'home', minutes: 15 },
    ],
    fixedBlocks: [
      { id: 'classes', title: 'Classes', rule: { kind: 'weekly', weekdays: WEEKDAYS }, start: '09:00', end: '15:00', locationId: 'campus', locked: true },
    ],
    mealRules: [{ id: 'dinner', name: 'Dinner', windowStart: '19:00', windowEnd: '20:30', duration: 45 }],
    availabilityWindows: WEEKDAYS.flatMap((d) => [
      { id: `h${d}`, weekday: d, start: '16:00', end: '19:00', energy: 'high' as const },
      { id: `n${d}`, weekday: d, start: '19:00', end: '23:00', energy: 'normal' as const },
    ]),
    availabilityOverrides: [],
    rules: [],
  }
}

export const midterm: Goal = {
  id: 'midterm', type: 'deadline', name: 'Algebra midterm', category: 'Study', color: '#2f5d50',
  priority: 2, focus: 'demanding', minSession: 45, maxSession: 90, active: true,
  deadline: '2026-12-12', totalHours: 15, reviewDays: 1, createdAt: 0,
}
export const workout: Goal = {
  id: 'workout', type: 'recurring', name: 'Workout', category: 'Fitness', color: '#c0504d',
  priority: 2, focus: 'light', minSession: 45, maxSession: 45, active: true,
  perWeek: 4, sessionLength: 45, noConsecutiveDays: true, locationId: 'gym', createdAt: 0,
}
export const reading: Goal = {
  id: 'reading', type: 'ongoing', name: 'Reading', category: 'Reading', color: '#7b4fa3',
  priority: 2, focus: 'light', minSession: 15, maxSession: 30, active: true, minutesPerDay: 30, createdAt: 0,
}

export function scenarioState(over: Partial<PlanState> = {}): PlanState {
  return {
    setup: scenarioSetup(),
    caps: { dailyCapWeekday: 6, dailyCapWeekend: 4, demandingCap: 4 },
    goals: [midterm, workout, reading],
    sessions: [],
    ...over,
  }
}
