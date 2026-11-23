import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { repos } from '../../db/repositories'
import type { Topic } from '../../db/types'
import { REVIEW_INTERVALS, effectiveWeight, reviewsHad, topicProgress, validateTopicName, validateWeight } from '../../domain/topics'
import { formatDuration } from '../../domain/time'
import { NumberInput, TextInput } from '../../ui/form'

/**
 * Topics of a deadline goal (SPEC 3.6): ordered list, weight, weak (1.5×), done (→ spaced reviews).
 * Every change is saved at once and re-plans.
 */
export function TopicsSection({ goalId, totalHours }: { goalId: string; totalHours: number }) {
  const topics = useLiveQuery(() => repos.topics.byGoal(goalId), [goalId])
  const sessions = useLiveQuery(() => db.sessions.where('goalId').equals(goalId).toArray(), [goalId], [])
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<string | null>(null)
  if (!topics) return null

  const wSum = topics.reduce((s, t) => s + effectiveWeight(t), 0) || 1
  const { done, total } = topicProgress(topics)

  const add = async () => {
    const err = validateTopicName(name, topics)
    setError(err)
    if (err) return
    await repos.topics.append({ goalId, name: name.trim(), weight: 1, weak: false, done: false, reviewsDone: 0 })
    setName('')
  }
  const move = async (t: Topic, dir: -1 | 1) => {
    const ids = topics.map((x) => x.id)
    const i = ids.indexOf(t.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    await repos.topics.reorder(goalId, ids)
  }
  const toggleDone = (t: Topic) =>
    repos.topics.update(t.id, t.done ? { done: false, doneAt: undefined } : { done: true, doneAt: Date.now() })

  return (
    <>
      <h2>
        Topics {total > 0 && <span className="muted topic-count">· {done} / {total} done</span>}
      </h2>
      <p className="muted">
        The goal’s hours are split across its topics in this order. Mark a topic <strong>weak</strong> to give it 1.5× the time, and{' '}
        <strong>done</strong> to get short reviews after {REVIEW_INTERVALS.join(', ')} days.
      </p>
      <div className="list topics-list">
        {topics.map((t, i) => {
          const share = Math.round(((totalHours * 60) * effectiveWeight(t)) / wSum)
          return (
            <div key={t.id} className={`topic-row${t.done ? ' done' : ''}`}>
              <div className="topic-move">
                <button type="button" className="btn small" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => void move(t, -1)}>
                  ↑
                </button>
                <button type="button" className="btn small" aria-label={`Move ${t.name} down`} disabled={i === topics.length - 1} onClick={() => void move(t, 1)}>
                  ↓
                </button>
              </div>
              {editing === t.id ? (
                <TopicEdit topic={t} others={topics} onDone={() => setEditing(null)} />
              ) : (
                <button type="button" className="topic-main" onClick={() => setEditing(t.id)}>
                  <strong>{t.name}</strong>
                  <span className="muted small">
                    ≈ {formatDuration(share)}
                    {t.weight !== 1 ? ` · weight ${t.weight}` : ''}
                    {t.done ? ` · reviews ${Math.min(reviewsHad(t.id, sessions), REVIEW_INTERVALS.length)} of ${REVIEW_INTERVALS.length}` : ''}
                  </span>
                </button>
              )}
              <button type="button" className={t.weak ? 'chip-toggle on weak' : 'chip-toggle'} aria-pressed={t.weak} onClick={() => void repos.topics.update(t.id, { weak: !t.weak })}>
                Weak
              </button>
              <button type="button" className={t.done ? 'chip-toggle on' : 'chip-toggle'} aria-pressed={t.done} onClick={() => void toggleDone(t)}>
                {t.done ? '✓ Done' : 'Done'}
              </button>
            </div>
          )
        })}
        <div className="topic-add">
          <TextInput value={name} placeholder={topics.length ? 'Add a topic' : 'e.g. Groups'} onChange={setName} />
          <button type="button" className="btn primary" onClick={() => void add()}>
            Add
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  )
}

function TopicEdit({ topic, others, onDone }: { topic: Topic; others: readonly Topic[]; onDone: () => void }) {
  const [name, setName] = useState(topic.name)
  const [weight, setWeight] = useState(topic.weight)
  const err = validateTopicName(name, others, topic.id) ?? validateWeight(weight)
  return (
    <div className="topic-edit">
      <TextInput value={name} onChange={setName} />
      <span className="topic-weight">
        <span className="muted small">Weight</span>
        <NumberInput value={weight} step={0.5} min={0.5} max={10} onChange={setWeight} />
      </span>
      <button
        type="button"
        className="btn small primary"
        disabled={!!err}
        onClick={async () => {
          await repos.topics.update(topic.id, { name: name.trim(), weight })
          onDone()
        }}
      >
        Save
      </button>
      <button
        type="button"
        className="btn small danger"
        onClick={async () => {
          if (window.confirm(`Delete the topic “${topic.name}”?`)) {
            await repos.topics.remove(topic.id)
            onDone()
          }
        }}
      >
        Delete
      </button>
      {err && <span className="error small">{err}</span>}
    </div>
  )
}
