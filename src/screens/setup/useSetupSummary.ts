import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import { weeklyAvailableMinutes } from '../../domain/setupValidation'
import { formatDuration } from '../../domain/time'
import type { SectionKey } from './sections'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One-line summary per setup section for the Settings menu. */
export function useSetupSummary(): Partial<Record<SectionKey, string>> {
  return (
    useLiveQuery(async () => {
      const [s, fixed, meals, locations, windows, rules] = await Promise.all([
        repos.settings.get(),
        db.fixedBlocks.count(),
        repos.mealRules.all(),
        db.locations.count(),
        repos.availabilityWindows.all(),
        db.rules.count(),
      ])
      const free = weeklyAvailableMinutes(windows)
      return {
        sleep: `${s.sleepStart}–${s.sleepEnd}`,
        fixed: fixed ? plural(fixed, 'block') : 'None yet',
        meals: meals.length
          ? [...meals].sort((a, b) => a.windowStart.localeCompare(b.windowStart)).map((m) => m.name).join(', ')
          : 'None yet',
        locations: locations ? plural(locations, 'place') : 'None yet',
        availability: free ? `${formatDuration(free)} per week` : 'Not set',
        rules: rules ? plural(rules, 'rule') : 'None',
        limits: `${s.dailyCapWeekday}h weekdays · ${s.dailyCapWeekend}h weekends · ${s.bufferMin} min buffer`,
        defaults: `${s.pomodoroWork}/${s.pomodoroBreak} focus · sound ${s.completionSound ? 'on' : 'off'}`,
      }
    }, []) ?? {}
  )
}
