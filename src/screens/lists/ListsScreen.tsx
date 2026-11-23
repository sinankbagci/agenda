import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { BacklogItem, BacklogList, BacklogType } from '../../db/types'
import { BACKLOG_TYPES, BACKLOG_TYPE_LABEL, finishBacklogItem, sortBacklog, stars, validateBacklogItem } from '../../domain/log'
import { Field, Problems, Segmented, TextInput, hasErrors } from '../../ui/form'

const LISTS = [
  { value: 'watch', label: '🎬 Want to watch' },
  { value: 'read', label: '📚 Want to read' },
] as const

/** /lists — Want to watch / Want to read backlogs (SPEC 4.5). */
export function ListsScreen() {
  const [list, setList] = useState<BacklogList>('watch')
  const items = useLiveQuery(() => repos.backlogItems.byList(list).then(sortBacklog), [list])
  const [finishing, setFinishing] = useState<BacklogItem | null>(null)
  if (!items) return null
  const section = (status: BacklogItem['status']) => items.filter((i) => i.status === status)

  return (
    <section className="screen lists-screen">
      <h1>Lists</h1>
      <Segmented value={list} options={LISTS} onChange={setList} />
      <AddItem list={list} />
      {(['inProgress', 'todo', 'finished'] as const).map((status) => {
        const rows = section(status)
        if (!rows.length) return null
        return (
          <div key={status}>
            <h2>{status === 'inProgress' ? 'In progress' : status === 'todo' ? 'To do' : 'Finished'}</h2>
            <div className="list">
              {rows.map((i) => (
                <ItemRow key={i.id} item={i} onFinish={() => setFinishing(i)} />
              ))}
            </div>
          </div>
        )
      })}
      {items.length === 0 && <p className="muted">Nothing here yet. Add something you’d like to {list === 'watch' ? 'watch' : 'read'}.</p>}
      {finishing && <FinishSheet item={finishing} onClose={() => setFinishing(null)} />}
    </section>
  )
}

function AddItem({ list }: { list: BacklogList }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<BacklogType>(BACKLOG_TYPES[list][0]!)
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const [tried, setTried] = useState(false)
  const types = BACKLOG_TYPES[list]
  const t = types.includes(type) ? type : types[0]!
  const check = validateBacklogItem({ title, link: link.trim() || undefined })

  const add = async () => {
    setTried(true)
    if (hasErrors(check)) return
    const item: Omit<BacklogItem, 'id'> = { list, title: title.trim(), type: t, status: 'todo', addedAt: Date.now() }
    if (link.trim()) item.link = link.trim()
    if (note.trim()) item.note = note.trim()
    await repos.backlogItems.add(item)
    setTitle('')
    setLink('')
    setNote('')
    setTried(false)
  }

  return (
    <div className="card add-item">
      <div className="add-row">
        <TextInput value={title} placeholder={list === 'watch' ? 'A movie, series or course…' : 'A book, article or course…'} onChange={setTitle} />
        <select className="input type-select" value={t} onChange={(e) => setType(e.target.value as BacklogType)} aria-label="Type">
          {types.map((x) => (
            <option key={x} value={x}>
              {BACKLOG_TYPE_LABEL[x]}
            </option>
          ))}
        </select>
        <button type="button" className="btn primary" onClick={() => void add()}>
          Add
        </button>
      </div>
      {more ? (
        <div className="form-grid">
          <Field label="Link (optional)">
            <input className="input" type="url" inputMode="url" value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <TextInput value={note} onChange={setNote} placeholder="Recommended by…" />
          </Field>
        </div>
      ) : (
        <button type="button" className="btn link small" onClick={() => setMore(true)}>
          + Link or note
        </button>
      )}
      <Problems check={tried ? check : { errors: [], warnings: [] }} />
    </div>
  )
}

function ItemRow({ item, onFinish }: { item: BacklogItem; onFinish: () => void }) {
  const navigate = useNavigate()
  const set = (status: BacklogItem['status']) => repos.backlogItems.update(item.id, { status })
  return (
    <div className={`list-item backlog-item st-${item.status}`}>
      <span className="row-main">
        <strong>{item.title}</strong>
        <span className="muted small">
          {BACKLOG_TYPE_LABEL[item.type]}
          {item.status === 'finished' && item.finishedAt ? ` · finished ${format(item.finishedAt, 'd MMM yyyy')}` : ` · added ${format(item.addedAt, 'd MMM')}`}
        </span>
        {item.rating && (
          <span className="rating" aria-label={`${item.rating} of 5 stars`}>
            {stars(item.rating)}
          </span>
        )}
        {item.note && <span className="log-note">{item.note}</span>}
        {item.link && (
          <a className="item-link" href={item.link} target="_blank" rel="noopener noreferrer">
            Open link ↗
          </a>
        )}
      </span>
      <span className="item-actions">
        {item.status === 'todo' && (
          <button type="button" className="btn small" onClick={() => void set('inProgress')}>
            Start
          </button>
        )}
        {item.status !== 'finished' && (
          <button type="button" className="btn small primary" onClick={onFinish}>
            Finished
          </button>
        )}
        {item.list === 'read' && item.type === 'book' && item.status !== 'finished' && (
          <button
            type="button"
            className="btn small"
            onClick={async () => {
              await set('inProgress')
              navigate(`/goals/new?template=book&name=${encodeURIComponent(item.title)}`)
            }}
          >
            📕 Make it a book goal
          </button>
        )}
        {item.status !== 'todo' && (
          <button type="button" className="btn small link" onClick={() => void repos.backlogItems.update(item.id, { status: 'todo', rating: undefined, finishedAt: undefined })}>
            Back to to do
          </button>
        )}
        <button
          type="button"
          className="btn small link danger"
          onClick={() => {
            if (window.confirm(`Remove “${item.title}” from the list?`)) void repos.backlogItems.remove(item.id)
          }}
        >
          Remove
        </button>
      </span>
    </div>
  )
}

/** Finished → rating (1–5) + short note → a log entry (SPEC 4.5). */
function FinishSheet({ item, onClose }: { item: BacklogItem; onClose: () => void }) {
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5 | undefined>(item.rating)
  const [note, setNote] = useState('')
  const save = async () => {
    if (!rating) return
    const now = Date.now()
    const r = finishBacklogItem(item, rating, note, now, format(now, 'yyyy-MM-dd'))
    await repos.backlogItems.put(r.item)
    await repos.logEntries.add(r.logEntry)
    onClose()
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Finished ${item.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <h2 className="sheet-title">Finished “{item.title}” 🎉</h2>
        <div className="field" role="group" aria-labelledby="rate-label">
          <span className="field-label" id="rate-label">
            How was it?
          </span>
          <div className="stars" role="radiogroup">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} className={rating && n <= rating ? 'star on' : 'star'} onClick={() => setRating(n)}>
                ★
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">A short note (optional)</span>
          <input className="input" type="text" maxLength={200} value={note} placeholder="What stayed with you?" onChange={(e) => setNote(e.target.value)} autoFocus />
        </label>
        <p className="muted small">It’s added to your log as “{item.list === 'watch' ? 'Watched' : 'Read'} {item.title}”.</p>
        <div className="button-row sheet-footer">
          <button type="button" className="btn primary" disabled={!rating} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
