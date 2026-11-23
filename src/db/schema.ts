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

/**
 * Dexie schema. First entry of each string is the primary key, the rest are indexes.
 * NEVER edit a published version — add a new `db.version(n + 1)` with an upgrade instead,
 * and bump SCHEMA_VERSION (backups record it).
 */
export const SCHEMA_V2 = {
  goals: 'id, type, category', // booleans can't be IndexedDB keys: filter `active` in memory
  topics: 'id, goalId, [goalId+order]',
  fixedBlocks: 'id',
  availabilityWindows: 'id, weekday',
  availabilityOverrides: 'id, date',
  mealRules: 'id',
  locations: 'id',
  travelTimes: '[fromId+toId], fromId, toId',
  rules: 'id, kind',
  settings: 'id',
  sessions: 'id, goalId, date, status, [goalId+date]',
  focusIntervals: 'id, goalId, sessionId, startedAt',
  activeTimer: 'id',
  logEntries: 'id, date, goalId',
  checkIns: 'date',
  backlogItems: 'id, list, status',
  weeklyReviews: 'weekStart',
  stats: '[goalId+bucket], goalId',
  meta: 'key',
} as const

export const SCHEMA_VERSION = 2

export type TableName = keyof typeof SCHEMA_V2

/** Row type of every table. */
export interface TableRows {
  goals: Goal
  topics: Topic
  fixedBlocks: FixedBlock
  availabilityWindows: AvailabilityWindow
  availabilityOverrides: AvailabilityOverride
  mealRules: MealRule
  locations: Location
  travelTimes: TravelTime
  rules: Rule
  settings: Settings
  sessions: Session
  focusIntervals: FocusInterval
  activeTimer: ActiveTimer
  logEntries: LogEntry
  checkIns: CheckIn
  backlogItems: BacklogItem
  weeklyReviews: WeeklyReview
  stats: Stats
  meta: Meta
}

export const TABLE_NAMES = Object.keys(SCHEMA_V2) as TableName[]

/** Tables included in a backup. `meta` is device-specific (e.g. storage-persisted flag). */
export const BACKUP_TABLES = TABLE_NAMES.filter((t) => t !== 'meta') as Exclude<TableName, 'meta'>[]
export type BackupTableName = (typeof BACKUP_TABLES)[number]

/** Primary-key field names of a table, read from the schema string ('id' or '[a+b]'). */
export function primaryKeyFields(table: TableName): string[] {
  const pk = SCHEMA_V2[table].split(',')[0]!.trim()
  return pk.startsWith('[') ? pk.slice(1, -1).split('+') : [pk]
}
