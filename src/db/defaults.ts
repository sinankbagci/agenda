import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  sleepStart: '00:00',
  sleepEnd: '08:00',
  bufferMin: 10,
  dailyCapWeekday: 6,
  dailyCapWeekend: 4,
  demandingCap: 4,
  pomodoroWork: 25,
  pomodoroBreak: 5,
  pomodoroLongBreak: 15,
  cyclesBeforeLong: 4,
  calendarAlertMin: 10,
  completionSound: true,
  onboardingDone: false,
}
