import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import type { Session } from '../../db/types'
import { shouldPromptCheckIn } from '../../domain/log'
import { CheckInCard } from './CheckInCard'

/** On Today, after the last planned item: "How was today?" (SPEC 4.1c). */
export function CheckInPrompt({ today, sessions, nowMin }: { today: string; sessions: readonly Session[]; nowMin: number }) {
  const state = useLiveQuery(async () => {
    const [c, dismissed] = await Promise.all([repos.checkIns.get(today), db.meta.get(`checkInDismissed:${today}`)])
    return { has: !!c, dismissed: !!dismissed }
  }, [today])
  if (!state || !shouldPromptCheckIn(sessions, nowMin, state.has, state.dismissed)) return null
  return (
    <div className="checkin-prompt">
      <h2>How was today?</h2>
      <CheckInCard date={today} onLater={() => void db.meta.put({ key: `checkInDismissed:${today}`, value: '1' })} />
    </div>
  )
}
