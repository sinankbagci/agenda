import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { DayData } from '../../domain/agenda'
import type { ISODate } from '../../db/types'

/** Sessions in [from, to] plus what's needed to label them. undefined while loading. */
export function usePlanData(from: ISODate, to: ISODate): DayData | undefined {
  return useLiveQuery(async () => {
    const [sessions, fixedBlocks, goals, locations, topics] = await Promise.all([
      repos.sessions.byRange(from, to),
      repos.fixedBlocks.all(),
      repos.goals.all(),
      repos.locations.all(),
      repos.topics.all(),
    ])
    return { sessions, fixedBlocks, goals, locations, topics }
  }, [from, to])
}
