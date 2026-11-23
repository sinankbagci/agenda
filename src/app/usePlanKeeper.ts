import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { db } from '../db/db'
import { replan } from '../db/planStore'

/** Everything the plan depends on, as one string. Sessions are excluded (replan writes them). */
async function planInputsSignature(): Promise<string> {
  const [settings, ...tables] = await Promise.all([
    db.settings.get('settings'),
    db.goals.toArray(),
    db.fixedBlocks.toArray(),
    db.availabilityWindows.toArray(),
    db.availabilityOverrides.toArray(),
    db.mealRules.toArray(),
    db.locations.toArray(),
    db.travelTimes.toArray(),
    db.rules.toArray(),
    db.topics.toArray(),
    db.logEntries.toArray(),
  ])
  // fields that don't affect planning mustn't trigger a re-plan
  const { lastBackupAt: _b, onboardingDone: _o, ...planSettings } = settings ?? ({} as Record<string, unknown>)
  return JSON.stringify([planSettings, tables])
}

let queue: Promise<unknown> = Promise.resolve()
/** Run re-plans one at a time. */
export function enqueueReplan(options?: Parameters<typeof replan>[1]) {
  queue = queue.then(() => replan(new Date(), options)).catch((e) => console.error('Re-plan failed', e))
  return queue
}

async function replanIfNewDay() {
  const row = await db.meta.get('plannedAt')
  const today = format(new Date(), 'yyyy-MM-dd')
  if (!row || format(new Date(Number(row.value)), 'yyyy-MM-dd') !== today) await enqueueReplan()
}

/**
 * Keeps the saved plan current (SPEC §3: "runs on app open if the date changed, and on any
 * goal / rule / availability edit"). Today stays frozen; see planStore.replan.
 */
export function usePlanKeeper(enabled: boolean) {
  const signature = useLiveQuery(planInputsSignature, [])
  const last = useRef<string | undefined>(undefined)

  // inputs changed → re-plan shortly after (several quick edits → one re-plan)
  useEffect(() => {
    if (!enabled || signature === undefined) return
    if (last.current === undefined) {
      last.current = signature
      void replanIfNewDay() // app open
      return
    }
    if (signature === last.current) return
    last.current = signature
    const t = setTimeout(() => void enqueueReplan(), 400)
    return () => clearTimeout(t)
  }, [signature, enabled])

  // a new day while the app was open or in the background
  useEffect(() => {
    if (!enabled) return
    const check = () => document.visibilityState === 'visible' && void replanIfNewDay()
    document.addEventListener('visibilitychange', check)
    const id = setInterval(check, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', check)
      clearInterval(id)
    }
  }, [enabled])
}
