import { describe, expect, it } from 'vitest'
import { assignTopics, effectiveWeight, finalReviewOrder, reviewsHad, spacedReviewDates, topicProgress, validateTopicName, validateWeight, workedByTopic } from './topics'
import type { Session, Topic } from '../db/types'

const topic = (id: string, order: number, over: Partial<Topic> = {}): Topic => ({ id, goalId: 'g', name: id, order, weight: 1, weak: false, done: false, reviewsDone: 0, ...over })
const SPEC = [topic('groups', 0), topic('subgroups', 1), topic('rings', 2), topic('homs', 3)] // SPEC example
const sess = (id: string, date: string, start: string, end: string, over: Partial<Session> = {}): Session => ({
  id, kind: 'goal', goalId: 'g', date, start, end, status: 'planned', frozen: false, ...over,
})
// 4 × 60 min + 4 × 60 = 8 sessions of 60 min = 480; 4 equal topics → 2 sessions each
const eight = Array.from({ length: 8 }, (_, i) => sess(`s${i}`, `2026-11-${String(23 + i).padStart(2, '0')}`, '16:00', '17:00'))
const labels = (m: Map<string, string[]>) => eight.map((s) => (m.get(s.id) ?? []).join('+'))

describe('assignTopics', () => {
  it('splits hours across topics in list order, proportional to weight', () => {
    expect(labels(assignTopics(SPEC, eight, 480, new Map()))).toEqual(['groups', 'groups', 'subgroups', 'subgroups', 'rings', 'rings', 'homs', 'homs'])
  })

  it('a weak topic gets 1.5× the time', () => {
    const t = [topic('a', 0, { weak: true }), topic('b', 1)] // shares 0.6 / 0.4 of 8 h → 288 / 192
    expect(effectiveWeight(t[0]!)).toBe(1.5)
    expect(labels(assignTopics(t, eight, 480, new Map()))).toEqual(['a', 'a', 'a', 'a', 'a+b', 'b', 'b', 'b'])
  })

  it('a session crossing from one topic to the next carries both', () => {
    const t = [topic('a', 0, { weight: 1.5 }), topic('b', 1, { weight: 2.5 })] // a = 180 min
    expect(labels(assignTopics(t, eight, 480, new Map()))).toEqual(['a', 'a', 'a', 'b', 'b', 'b', 'b', 'b'])
    const odd = [topic('a', 0), topic('b', 1), topic('c', 2)] // 160 each
    expect(labels(assignTopics(odd, eight, 480, new Map()))).toEqual(['a', 'a', 'a+b', 'b', 'b', 'b+c', 'c', 'c'])
  })

  it('respects the user’s order, not names or creation', () => {
    const reordered = [topic('groups', 2), topic('subgroups', 3), topic('rings', 0), topic('homs', 1)]
    expect(labels(assignTopics(reordered, eight, 480, new Map()))[0]).toBe('rings')
  })

  it('done topics get nothing new; time already worked counts', () => {
    const t = [topic('groups', 0, { done: true }), topic('subgroups', 1), topic('rings', 2), topic('homs', 3)]
    // 960 total → 240 each; subgroups already got 180 → needs 60; rings 240; homs 240 → scaled to 480 planned
    const worked = new Map([['groups', 240], ['subgroups', 180]])
    expect(labels(assignTopics(t, eight, 960, worked))).toEqual(['subgroups', 'rings', 'rings', 'rings', 'rings+homs', 'homs', 'homs', 'homs'])
  })

  it('no open topics → no labels', () => {
    expect(assignTopics([topic('a', 0, { done: true })], eight, 480, new Map()).size).toBe(0)
    expect(assignTopics([], eight, 480, new Map()).size).toBe(0)
  })

  it('worked minutes come from stored sessions, split between their topics', () => {
    const w = workedByTopic([
      sess('x', '2026-11-20', '16:00', '17:00', { status: 'done', topicIds: ['a'] }),
      sess('y', '2026-11-21', '16:00', '17:00', { status: 'partial', actualMinutes: 40, topicIds: ['a', 'b'] }),
      sess('z', '2026-11-22', '16:00', '17:00', { status: 'skipped', topicIds: ['b'] }),
      sess('f', '2026-11-23', '16:00', '16:30', { frozen: true, topicIds: ['b'] }),
    ])
    expect(Object.fromEntries(w)).toEqual({ a: 80, b: 50 })
  })
})

describe('spaced review', () => {
  it('+2, +5, +10 days after the topic is done', () => {
    expect(spacedReviewDates('2026-11-23', 0, '2026-11-24', '2026-12-11')).toEqual(['2026-11-25', '2026-11-28', '2026-12-03'])
  })
  it('only while they land before the final review day', () => {
    expect(spacedReviewDates('2026-12-04', 0, '2026-12-05', '2026-12-11')).toEqual(['2026-12-06', '2026-12-09'])
    expect(spacedReviewDates('2026-12-09', 0, '2026-12-10', '2026-12-11')).toEqual([])
  })
  it('skips reviews already had; a missed one moves to the first possible day', () => {
    expect(spacedReviewDates('2026-11-10', 1, '2026-11-23', '2026-12-11')).toEqual(['2026-11-23', '2026-11-24'])
    expect(spacedReviewDates('2026-11-10', 3, '2026-11-23', '2026-12-11')).toEqual([])
  })
  it('counts reviews had per topic', () => {
    const r = (status: Session['status'], ids: string[], spacedReview = true) => sess(`${status}${ids}${spacedReview}`, '2026-11-25', '10:00', '10:20', { kind: 'review', status, topicIds: ids, spacedReview })
    // a final review of a one-topic goal also has topicIds ['a'] — it's not a spaced review
    expect(reviewsHad('a', [r('done', ['a']), r('partial', ['a']), r('skipped', ['a']), r('planned', ['a']), r('done', ['a'], false)])).toBe(2)
  })
})

describe('final review, progress, validation', () => {
  it('final review covers every topic, weak first', () => {
    const t = [topic('groups', 0), topic('subgroups', 1, { weak: true }), topic('rings', 2), topic('homs', 3, { weak: true })]
    expect(finalReviewOrder(t)).toEqual(['subgroups', 'homs', 'groups', 'rings'])
  })
  it('3 / 6 topics done', () => {
    const t = [0, 1, 2, 3, 4, 5].map((i) => topic(`t${i}`, i, { done: i < 3 }))
    expect(topicProgress(t)).toEqual({ done: 3, total: 6 })
  })
  it('validates names and weights', () => {
    expect(validateTopicName('  ', SPEC)).toBe('Give the topic a name.')
    expect(validateTopicName('Rings', SPEC)).toBe('That topic is already in the list.')
    expect(validateTopicName('rings', SPEC, 'rings')).toBeUndefined()
    expect(validateWeight(1)).toBeUndefined()
    expect(validateWeight(0)).toBeDefined()
    expect(validateWeight(11)).toBeDefined()
  })
})
