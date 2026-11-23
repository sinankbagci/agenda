import { createDb } from '../db/db'
import type { Goal, Session } from '../db/types'

/** A fresh, isolated database per test. */
export const freshDb = () => createDb(`test-${crypto.randomUUID()}`)

export const goalInput = (over: Partial<Goal> = {}): Omit<Goal, 'id'> => ({
  type: 'deadline',
  name: 'Algebra midterm',
  category: 'Study',
  color: '#2f5d50',
  priority: 2,
  focus: 'demanding',
  minSession: 30,
  maxSession: 90,
  active: true,
  deadline: '2026-12-12',
  totalHours: 15,
  reviewDays: 1,
  createdAt: 1_700_000_000_000,
  ...over,
})

export const sessionRow = (over: Partial<Session> = {}): Session => ({
  id: crypto.randomUUID(),
  kind: 'goal',
  date: '2026-11-24',
  start: '16:00',
  end: '17:00',
  status: 'planned',
  frozen: false,
  ...over,
})
