import { describe, expect, it } from 'vitest'
import { availabilityFor, buildDay, buildDays, fixedOccursOn, makeTravel, ruleCuts, sleepRanges, weekdayOf, type DayLayout, type SlotInput } from './freeSlots'
import { fromMinutes } from './time'
import type { FixedBlock, Weekday } from '../db/types'

// 2026-11-23 is a Monday.
const MON = '2026-11-23'
const TUE = '2026-11-24'
const SAT = '2026-11-28'
const SUN = '2026-11-29'

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5]

/** SPEC §7 acceptance scenario (setup part). */
function scenario(): SlotInput {
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

const t = fromMinutes
const fmtBlocks = (d: DayLayout) =>
  d.blocks.map((b) => {
    const range = `${t(b.start)}–${t(b.end)}`
    switch (b.kind) {
      case 'sleep':
        return `sleep ${range}`
      case 'fixed':
        return `${b.title} ${range}`
      case 'meal':
        return `${b.name} ${range}`
      case 'travel':
        return `travel ${b.fromId}→${b.toId} ${range}`
    }
  })
const fmtFree = (d: DayLayout) => d.free.map((f) => `${t(f.start)}–${t(f.end)} ${f.energy}${f.locationId ? ` @${f.locationId}` : ''}`)

describe('acceptance scenario', () => {
  it('weekday: classes on campus, travel both ways, dinner, buffers', () => {
    const d = buildDay(scenario(), MON)
    expect(d.weekday).toBe(1)
    expect(fmtBlocks(d)).toEqual([
      'sleep 00:00–08:00',
      'travel home→campus 08:40–09:00', // arrive just in time
      'Classes 09:00–15:00',
      'travel campus→home 15:00–15:20', // straight home after
      'Dinner 19:00–19:45',
    ])
    expect(fmtFree(d)).toEqual([
      '16:00–18:50 high @home', // 10 min buffer before dinner; window edge at 16:00 has no buffer
      '19:55–23:00 normal @home', // 10 min buffer after dinner
    ])
    expect(d.freeMinutes).toBe(170 + 185)
    expect(d.warnings).toEqual([])
  })

  it('never puts free time inside class, dinner or sleep, on any day', () => {
    for (const d of buildDays(scenario(), MON, 14)) {
      const busy = d.blocks
      for (const f of d.free) {
        for (const b of busy) expect(f.start < b.end && b.start < f.end, `${d.date} ${fmtFree(d)}`).toBe(false)
      }
    }
  })

  it('weekend: no classes, no travel, dinner still placed, no free time without availability', () => {
    const d = buildDay(scenario(), SAT)
    expect(fmtBlocks(d)).toEqual(['sleep 00:00–08:00', 'Dinner 19:00–19:45'])
    expect(d.free).toEqual([])
  })

  it('builds consecutive days with the right weekdays', () => {
    const days = buildDays(scenario(), MON, 7)
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(days.map((d) => d.freeMinutes)).toEqual([355, 355, 355, 355, 355, 0, 0])
  })

  it('is deterministic and does not mutate its input', () => {
    const input = scenario()
    const copy = structuredClone(input)
    expect(buildDay(input, MON)).toEqual(buildDay(input, MON))
    expect(input).toEqual(copy)
  })
})

describe('sleep', () => {
  it('handles sleep that wraps past midnight', () => {
    expect(sleepRanges('23:00', '07:00')).toEqual([
      { start: 0, end: 420 },
      { start: 1380, end: 1440 },
    ])
    const input = scenario()
    input.settings = { ...input.settings, sleepStart: '22:30', sleepEnd: '07:00' }
    expect(fmtFree(buildDay(input, MON)).at(-1)).toBe('19:55–22:30 normal @home')
  })

  it('cuts availability that overlaps sleep', () => {
    const input = scenario()
    input.availabilityWindows = [{ id: 'w', weekday: 6, start: '06:00', end: '10:00', energy: 'high' }]
    expect(fmtFree(buildDay(input, SAT))).toEqual(['08:00–10:00 high @home'])
  })
})

describe('fixed program', () => {
  const block = (rule: FixedBlock['rule']): FixedBlock => ({ id: 'b', title: 'B', rule, start: '10:00', end: '11:00', locked: true })

  it('respects weekdays and from/until dates', () => {
    const b = block({ kind: 'weekly', weekdays: [1], from: '2026-11-23', until: '2026-12-07' })
    expect(fixedOccursOn(b, '2026-11-16', 1)).toBe(false) // before
    expect(fixedOccursOn(b, '2026-11-23', 1)).toBe(true) // first day
    expect(fixedOccursOn(b, '2026-11-24', 2)).toBe(false) // wrong weekday
    expect(fixedOccursOn(b, '2026-12-07', 1)).toBe(true) // last day
    expect(fixedOccursOn(b, '2026-12-14', 1)).toBe(false) // after
  })

  it('one-off blocks only occur on their date', () => {
    const input = scenario()
    input.fixedBlocks = [{ ...block({ kind: 'once', date: SAT }), title: 'Dentist', start: '17:00', end: '18:00' }]
    input.availabilityWindows = [{ id: 'w', weekday: 6, start: '14:00', end: '20:00', energy: 'normal' }]
    input.mealRules = []
    expect(fmtFree(buildDay(input, SAT))).toEqual(['14:00–16:50 normal @home', '18:10–20:00 normal @home'])
    expect(fmtFree(buildDay(input, '2026-12-05'))).toEqual(['14:00–20:00 normal @home'])
  })

  it('warns when fixed blocks overlap', () => {
    const input = scenario()
    input.fixedBlocks = [...input.fixedBlocks, { id: 'meeting', title: 'Meeting', rule: { kind: 'once', date: MON }, start: '14:00', end: '16:00', locationId: 'campus', locked: true }]
    const d = buildDay(input, MON)
    expect(d.warnings.map((w) => w.kind)).toEqual(['fixedOverlap'])
    expect(d.warnings[0]!.message).toContain('“Classes” and “Meeting” overlap')
  })
})

describe('meals', () => {
  it('moves a meal later in its window when the start is blocked', () => {
    const input = scenario()
    input.mealRules = [{ id: 'lunch', name: 'Lunch', windowStart: '12:00', windowEnd: '16:00', duration: 30 }]
    // classes until 15:00, then the 20-min trip home must still fit: lunch at 15:00 would block it → 15:00 is
    // fine for an unlocated meal only if travel still fits before bedtime (it does, after lunch).
    const d = buildDay(input, MON)
    expect(fmtBlocks(d)).toContain('Lunch 15:00–15:30')
    expect(fmtBlocks(d)).toContain('travel campus→home 15:30–15:50') // eat on campus, then go home
  })

  it('warns when a meal cannot fit its window', () => {
    const input = scenario()
    input.mealRules = [{ id: 'lunch', name: 'Lunch', windowStart: '12:00', windowEnd: '14:30', duration: 30 }]
    const d = buildDay(input, MON)
    expect(d.blocks.some((b) => b.kind === 'meal')).toBe(false)
    expect(d.warnings).toEqual([{ kind: 'mealNotPlaced', mealId: 'lunch', message: 'No room for Lunch (30 min between 12:00–14:30).' }])
    // on Saturday there's no class, so it fits at the start of its window
    expect(fmtBlocks(buildDay(input, SAT))).toContain('Lunch 12:00–12:30')
  })

  it('places meals in window order and never overlaps them', () => {
    const input = scenario()
    input.mealRules = [
      { id: 'b', name: 'Second', windowStart: '19:00', windowEnd: '21:00', duration: 30 },
      { id: 'a', name: 'First', windowStart: '19:00', windowEnd: '20:00', duration: 45 },
    ]
    expect(fmtBlocks(buildDay(input, SAT))).toEqual(['sleep 00:00–08:00', 'First 19:00–19:45', 'Second 19:45–20:15'])
  })

  it('a meal never takes the only gap you need for travel; it moves later instead', () => {
    const input = scenario()
    input.travelTimes = [...input.travelTimes, { fromId: 'campus', toId: 'gym', minutes: 25 }]
    input.fixedBlocks = [
      { id: 'c', title: 'Class', rule: { kind: 'weekly', weekdays: [6] }, start: '10:00', end: '12:00', locationId: 'campus', locked: true },
      { id: 'g', title: 'Training', rule: { kind: 'weekly', weekdays: [6] }, start: '12:30', end: '13:30', locationId: 'gym', locked: true },
    ]
    input.mealRules = [{ id: 'lunch', name: 'Lunch', windowStart: '12:00', windowEnd: '15:00', duration: 30 }]
    const d = buildDay(input, SAT)
    expect(fmtBlocks(d)).toEqual([
      'sleep 00:00–08:00',
      'travel home→campus 09:40–10:00',
      'Class 10:00–12:00',
      'travel campus→gym 12:05–12:30',
      'Training 12:30–13:30',
      'Lunch 13:30–14:00', // not 12:00, which would leave no time to get to the gym
      'travel gym→home 14:00–14:15',
    ])
    expect(d.warnings).toEqual([])
  })

  it('an existing travel conflict does not stop meals from being placed', () => {
    const input = scenario()
    input.travelTimes = [...input.travelTimes, { fromId: 'campus', toId: 'gym', minutes: 25 }]
    input.fixedBlocks = [...input.fixedBlocks, { id: 'pt', title: 'PT', rule: { kind: 'weekly', weekdays: [1] }, start: '15:10', end: '16:00', locationId: 'gym', locked: true }]
    const d = buildDay(input, MON)
    expect(fmtBlocks(d)).toContain('Dinner 19:00–19:45')
    expect(d.warnings.map((w) => w.kind)).toEqual(['travelTooTight'])
  })

  it('a meal at another place gets travel there and back, and leaves room for it', () => {
    const input = scenario()
    input.mealRules = [{ id: 'gymlunch', name: 'Gym lunch', windowStart: '08:00', windowEnd: '10:00', duration: 30, locationId: 'gym' }]
    const d = buildDay(input, SAT)
    // can't start at 08:00: you wake up at home and need 15 min to get there
    expect(fmtBlocks(d)).toEqual(['sleep 00:00–08:00', 'travel home→gym 08:00–08:15', 'Gym lunch 08:15–08:45', 'travel gym→home 08:45–09:00'])
  })
})

describe('travel', () => {
  it('free slots know where you are, e.g. after travel', () => {
    const input = scenario()
    input.availabilityWindows = [{ id: 'w', weekday: 1, start: '08:00', end: '23:00', energy: 'normal' }]
    expect(fmtFree(buildDay(input, MON))).toEqual(['08:00–08:30 normal @home', '15:30–18:50 normal @home', '19:55–23:00 normal @home'])
  })

  it('warns and still shows travel that does not fit between two places', () => {
    const input = scenario()
    input.travelTimes = [...input.travelTimes, { fromId: 'campus', toId: 'gym', minutes: 25 }]
    input.fixedBlocks = [...input.fixedBlocks, { id: 'pt', title: 'PT session', rule: { kind: 'weekly', weekdays: [1] }, start: '15:10', end: '16:00', locationId: 'gym', locked: true }]
    const d = buildDay(input, MON)
    expect(fmtBlocks(d)).toContain('travel campus→gym 14:45–15:10')
    expect(d.warnings.map((w) => w.kind)).toEqual(['travelTooTight'])
    expect(d.warnings[0]!.message).toBe('Not enough time to travel from Campus to Gym (25 min) around 15:10.')
  })

  it('warns once when a travel time is missing and assumes 0', () => {
    const input = scenario()
    input.travelTimes = []
    const d = buildDay(input, MON)
    expect(d.blocks.some((b) => b.kind === 'travel')).toBe(false)
    expect(d.warnings).toEqual([
      { kind: 'travelUnknown', fromId: 'home', toId: 'campus', message: 'No travel time set between Home and Campus; assuming 0 min.' },
    ])
  })

  it('inserts no travel when no home is set', () => {
    const input = scenario()
    input.settings = { ...input.settings, homeLocationId: undefined }
    const d = buildDay(input, MON)
    expect(d.blocks.some((b) => b.kind === 'travel')).toBe(false)
    expect(d.warnings).toEqual([])
    expect(d.free[0]!.locationId).toBe('campus') // last known place
  })

  it('travel lookup is symmetric and 0 for same/unknown places', () => {
    const travel = makeTravel([{ fromId: 'a', toId: 'b', minutes: 12 }])
    expect(travel('a', 'b')).toBe(12)
    expect(travel('b', 'a')).toBe(12)
    expect(travel('a', 'a')).toBe(0)
    expect(travel(undefined, 'a')).toBe(0)
    expect(travel('a', 'c')).toBeUndefined()
  })
})

describe('availability & overrides', () => {
  it('de-overlaps windows (earlier window wins) and keeps energy', () => {
    const input = scenario()
    input.availabilityWindows = [
      { id: 'a', weekday: 6, start: '10:00', end: '13:00', energy: 'high' },
      { id: 'b', weekday: 6, start: '12:00', end: '15:00', energy: 'low' },
    ]
    expect(availabilityFor(input, SAT, 6)).toEqual([
      { start: 600, end: 780, energy: 'high' },
      { start: 780, end: 900, energy: 'low' },
    ])
  })

  it('busy all day removes all free time', () => {
    const input = scenario()
    input.availabilityOverrides = [{ id: 'o', date: MON, kind: 'busy' }]
    expect(buildDay(input, MON).free).toEqual([])
    expect(buildDay(input, TUE).free).toHaveLength(2)
  })

  it('busy part of a day cuts that part only', () => {
    const input = scenario()
    input.availabilityOverrides = [{ id: 'o', date: MON, kind: 'busy', start: '17:00', end: '18:00' }]
    expect(fmtFree(buildDay(input, MON))).toEqual(['16:00–17:00 high @home', '18:00–18:50 high @home', '19:55–23:00 normal @home'])
  })

  it('a free override can carry its own energy', () => {
    const input = scenario()
    input.availabilityOverrides = [{ id: 'o', date: SAT, kind: 'free', start: '10:00', end: '12:00', energy: 'high' }]
    expect(fmtFree(buildDay(input, SAT))).toEqual(['10:00–12:00 high @home'])
  })

  it('a free override adds time with normal energy without changing tagged windows', () => {
    const input = scenario()
    input.availabilityOverrides = [{ id: 'o', date: SUN, kind: 'free', start: '13:00', end: '17:00' }]
    input.availabilityWindows = [...input.availabilityWindows, { id: 's', weekday: 0, start: '15:00', end: '18:00', energy: 'high' }]
    expect(fmtFree(buildDay(input, SUN))).toEqual(['13:00–15:00 normal @home', '15:00–18:00 high @home'])
  })
})

describe('rules & buffers', () => {
  it('keepFree and category-less rules cut free time; category rules are left to the planner', () => {
    const input = scenario()
    input.rules = [
      { id: 'r1', kind: 'keepFree', params: { weekday: 1, start: '17:00', end: '18:00' } },
      { id: 'r2', kind: 'noGoalAfter', params: { time: '22:00' } },
      { id: 'r3', kind: 'noGoalBefore', params: { time: '20:30', category: 'Study' } }, // planner's job
    ]
    expect(fmtFree(buildDay(input, MON))).toEqual(['16:00–17:00 high @home', '18:00–18:50 high @home', '19:55–22:00 normal @home'])
    expect(ruleCuts(input.rules, 2)).toEqual([{ start: 1320, end: 1440 }])
  })

  it('buffer 0 leaves slots touching blocks', () => {
    const input = scenario()
    input.settings = { ...input.settings, bufferMin: 0 }
    expect(fmtFree(buildDay(input, MON))).toEqual(['16:00–19:00 high @home', '19:45–23:00 normal @home'])
  })

  it('drops slots that buffers eat completely', () => {
    const input = scenario()
    input.availabilityWindows = [{ id: 'w', weekday: 6, start: '18:45', end: '19:00', energy: 'normal' }]
    input.settings = { ...input.settings, bufferMin: 20 }
    expect(buildDay(input, SAT).free).toEqual([])
  })
})

describe('weekdayOf', () => {
  it('reads the local weekday of an ISO date', () => {
    expect(weekdayOf('2026-11-23')).toBe(1)
    expect(weekdayOf('2026-11-29')).toBe(0)
    expect(weekdayOf('2027-01-01')).toBe(5)
  })
})
