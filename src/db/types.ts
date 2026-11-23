/**
 * Data model — SPEC §6.
 *
 * Conventions (keep these consistent everywhere):
 * - `id`            string UUID (stable across export/import).
 * - `*Date`, `date`  calendar day in local time, 'yyyy-MM-dd'.
 * - times of day     'HH:mm' (24h, local).
 * - `*At` fields     epoch milliseconds.
 * - durations        minutes unless the field name says hours.
 */

export type ISODate = string // 'yyyy-MM-dd'
export type TimeOfDay = string // 'HH:mm'
export type EpochMs = number

/** 0 = Sunday … 6 = Saturday (same as Date.getDay / date-fns). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

// ---------- Goals ----------

export type GoalType = 'deadline' | 'recurring' | 'ongoing' | 'book'
export type GoalCategory = 'Study' | 'Fitness' | 'Reading' | 'Learning' | 'Other'
export type Priority = 1 | 2 | 3
export type FocusLevel = 'demanding' | 'light'
export type TimeBucket = 'morning' | 'afternoon' | 'evening'

export interface Goal {
  id: string
  type: GoalType
  name: string
  category: GoalCategory
  color: string
  icon?: string
  priority: Priority
  focus: FocusLevel
  minSession: number
  maxSession: number
  preferredTime?: TimeBucket
  locationId?: string
  active: boolean
  // deadline
  deadline?: ISODate
  totalHours?: number
  reviewDays?: number
  // recurring
  perWeek?: number
  sessionLength?: number
  noConsecutiveDays?: boolean
  // ongoing
  minutesPerDay?: number
  minutesPerWeek?: number
  endDate?: ISODate
  // book
  totalPages?: number
  pagesDone?: number
  // focus overrides
  pomodoroWork?: number
  pomodoroBreak?: number
  pomodoroLongBreak?: number
  cyclesBeforeLong?: number
  createdAt: EpochMs
}

export interface Topic {
  id: string
  goalId: string
  name: string
  order: number
  weight: number
  weak: boolean
  done: boolean
  doneAt?: EpochMs
  reviewsDone: number
}

// ---------- Fixed program & constraints ----------

export type FixedRule =
  | { kind: 'weekly'; weekdays: Weekday[]; from?: ISODate; until?: ISODate }
  | { kind: 'once'; date: ISODate }

export interface FixedBlock {
  id: string
  title: string
  rule: FixedRule
  start: TimeOfDay
  end: TimeOfDay
  locationId?: string
  locked: true
}

export type Energy = 'high' | 'normal' | 'low'

export interface AvailabilityWindow {
  id: string
  weekday: Weekday
  start: TimeOfDay
  end: TimeOfDay
  energy: Energy
}

export interface AvailabilityOverride {
  id: string
  date: ISODate
  /** Omit start/end to cover the whole day. */
  start?: TimeOfDay
  end?: TimeOfDay
  kind: 'busy' | 'free'
  /** Extra free time only: energy of that time (default normal). */
  energy?: Energy
  /**
   * Extra free time only: "use it for" these goals. Deadline goals pull work into it;
   * ongoing / book goals may go beyond their usual target there.
   */
  boostGoalIds?: string[]
}

export interface MealRule {
  id: string
  name: string
  windowStart: TimeOfDay
  windowEnd: TimeOfDay
  duration: number
  locationId?: string
}

export interface Location {
  id: string
  name: string
}

export interface TravelTime {
  fromId: string
  toId: string
  minutes: number
}

export type Rule =
  | { id: string; kind: 'noGoalAfter'; params: { time: TimeOfDay; category?: GoalCategory } }
  | { id: string; kind: 'noGoalBefore'; params: { time: TimeOfDay; category?: GoalCategory } }
  | { id: string; kind: 'keepFree'; params: { weekday: Weekday; start: TimeOfDay; end: TimeOfDay } }

export type RuleKind = Rule['kind']

export interface Settings {
  id: 'settings'
  sleepStart: TimeOfDay
  sleepEnd: TimeOfDay
  bufferMin: number
  /** Max planned goal hours per day. */
  dailyCapWeekday: number
  dailyCapWeekend: number
  /** Max demanding hours per day. */
  demandingCap: number
  homeLocationId?: string
  lastBackupAt?: EpochMs
  pomodoroWork: number
  pomodoroBreak: number
  pomodoroLongBreak: number
  cyclesBeforeLong: number
  calendarAlertMin: number
  /** Soft chime when a session is completed (iOS has no vibration). */
  completionSound: boolean
  onboardingDone: boolean
}

// ---------- Plan & tracking ----------

export type SessionKind = 'goal' | 'meal' | 'travel' | 'review'
export type SessionStatus = 'planned' | 'done' | 'partial' | 'skipped'

export interface Session {
  id: string
  goalId?: string
  topicIds?: string[]
  kind: SessionKind
  date: ISODate
  start: TimeOfDay
  end: TimeOfDay
  status: SessionStatus
  actualMinutes?: number
  note?: string
  frozen: boolean
  /** Placed by the user at a chosen time ("+ Add" → Goal session). Always also frozen. */
  pinned?: boolean
  /** Display label for meals ("Lunch"); goal sessions use the goal's name. */
  label?: string
  mealId?: string
  /** Where a goal session or meal happens. */
  locationId?: string
  /** Travel sessions: from → to. */
  fromLocationId?: string
  toLocationId?: string
}

export type FocusPhase = 'work' | 'break' | 'longBreak'

export interface FocusInterval {
  id: string
  goalId: string
  topicId?: string
  sessionId?: string
  phase: FocusPhase
  startedAt: EpochMs
  endedAt: EpochMs
  minutes: number
}

export interface FocusConfig {
  /** Minutes. */
  work: number
  shortBreak: number
  longBreak: number
  cyclesBeforeLong: number
}

/**
 * The one running Focus timer. Pure timestamps — remaining time is always computed from
 * `phaseStartedAt` + `phaseLength` (+ `pausedAt`), never counted (Safari suspends JS).
 */
export interface ActiveTimer {
  id: 'active'
  goalId: string
  topicId?: string
  sessionId?: string
  phase: FocusPhase
  phaseStartedAt: EpochMs
  /** Minutes. */
  phaseLength: number
  /** 1-based number of the current work cycle. */
  cycle: number
  pausedAt?: EpochMs
  /** When this focus run started (its intervals have startedAt ≥ this). */
  runStartedAt: EpochMs
  /** Cycle lengths for this run (goal override or defaults, fixed at start). */
  config: FocusConfig
  /** Today's sessions this run fills, in order, with the minutes they already had. */
  targets: { id: string; prior: number }[]
}

export interface LogEntry {
  id: string
  date: ISODate
  type: string
  title: string
  minutes?: number
  amount?: number
  note?: string
  goalId?: string
}

export interface CheckIn {
  date: ISODate
  energy: 1 | 2 | 3 | 4 | 5
  mood: 1 | 2 | 3 | 4 | 5
  note?: string
}

export type BacklogList = 'watch' | 'read'
export type BacklogType = 'movie' | 'series' | 'book' | 'article' | 'course' | 'other'

export interface BacklogItem {
  id: string
  list: BacklogList
  title: string
  type: BacklogType
  link?: string
  note?: string
  status: 'todo' | 'inProgress' | 'finished'
  rating?: 1 | 2 | 3 | 4 | 5
  finishedAt?: EpochMs
  addedAt: EpochMs
}

export interface WeeklyReview {
  /** Monday of the reviewed week. */
  weekStart: ISODate
  confirmedAt: EpochMs
  adjustments: unknown[]
}

export interface Stats {
  goalId: string
  bucket: TimeBucket
  attempts: number
  completions: number
  focusMinutes: number
}

export interface Meta {
  key: string
  value: string
}

/** `Omit<T, 'id'>` that also works on union types (e.g. Rule): the shape of a row before it's saved. */
export type NewRow<T> = T extends unknown ? Omit<T, 'id'> : never
