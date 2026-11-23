import Dexie, { type EntityTable, type Table } from 'dexie'
import { SCHEMA_V2 } from './schema'
import type {
  ActiveTimer,
  AvailabilityOverride,
  AvailabilityWindow,
  BacklogItem,
  CheckIn,
  FixedBlock,
  FocusInterval,
  Goal,
  Location,
  LogEntry,
  MealRule,
  Meta,
  Rule,
  Session,
  Settings,
  Stats,
  Topic,
  TravelTime,
  WeeklyReview,
} from './types'

export type AgendaDB = Dexie & {
  goals: EntityTable<Goal, 'id'>
  topics: EntityTable<Topic, 'id'>
  fixedBlocks: EntityTable<FixedBlock, 'id'>
  availabilityWindows: EntityTable<AvailabilityWindow, 'id'>
  availabilityOverrides: EntityTable<AvailabilityOverride, 'id'>
  mealRules: EntityTable<MealRule, 'id'>
  locations: EntityTable<Location, 'id'>
  travelTimes: Table<TravelTime, [string, string]>
  rules: EntityTable<Rule, 'id'>
  settings: EntityTable<Settings, 'id'>
  sessions: EntityTable<Session, 'id'>
  focusIntervals: EntityTable<FocusInterval, 'id'>
  activeTimer: EntityTable<ActiveTimer, 'id'>
  logEntries: EntityTable<LogEntry, 'id'>
  checkIns: EntityTable<CheckIn, 'date'>
  backlogItems: EntityTable<BacklogItem, 'id'>
  weeklyReviews: EntityTable<WeeklyReview, 'weekStart'>
  stats: Table<Stats, [string, string]>
  meta: EntityTable<Meta, 'key'>
}

export function createDb(name = 'agenda'): AgendaDB {
  const db = new Dexie(name) as AgendaDB
  // v1 = step-1 scaffold (meta only).
  db.version(1).stores({ meta: 'key' })
  db.version(2).stores(SCHEMA_V2)
  return db
}

export const db = createDb()
