import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import type { FixedBlock } from '../../db/types'
import { validateFixedBlock } from '../../domain/setupValidation'
import { DateInput, Field, LocationSelect, Problems, Segmented, TextInput, TimeInput, WeekdayPicker, hasErrors } from '../../ui/form'

type Draft = Omit<FixedBlock, 'id'>

const blank = (): Draft => ({
  title: '',
  rule: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] },
  start: '09:00',
  end: '15:00',
  locked: true,
})

/** The only place a fixed block can be changed (SPEC 2.2). */
export function FixedBlockEditScreen() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft | null>(isNew ? blank() : null)
  const [missing, setMissing] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (isNew || !id) return
    repos.fixedBlocks.get(id).then((b) => {
      if (!b) return setMissing(true)
      const { id: _id, ...d } = b
      setDraft(d)
    })
  }, [id, isNew])

  if (missing) return <section className="screen"><h1>Not found</h1><button className="btn" onClick={() => navigate(-1)}>Back</button></section>
  if (!draft) return null

  const check = validateFixedBlock(draft)
  const rule = draft.rule
  const today = format(new Date(), 'yyyy-MM-dd')

  async function save() {
    setTried(true)
    if (hasErrors(check) || !draft) return
    const clean = { ...draft, title: draft.title.trim(), locked: true as const }
    if (isNew) await repos.fixedBlocks.add(clean)
    else await repos.fixedBlocks.put({ ...clean, id: id! })
    navigate(-1)
  }

  async function remove() {
    if (!window.confirm(`Delete “${draft!.title}” from your fixed program?`)) return
    await repos.fixedBlocks.remove(id!)
    navigate(-1)
  }

  return (
    <section className="screen">
      <button type="button" className="back" onClick={() => navigate(-1)}>
        ‹ Back
      </button>
      <h1>{isNew ? 'New fixed block' : 'Edit fixed block'}</h1>
      <p className="muted">🔒 Locked: the planner schedules around this and never moves it.</p>
      <div className="card">
        <div className="form-grid">
          <Field label="Title">
            <TextInput value={draft.title} placeholder="Classes" onChange={(title) => setDraft({ ...draft, title })} />
          </Field>
          <Field label="Location">
            <LocationSelect value={draft.locationId} onChange={(locationId) => setDraft({ ...draft, locationId })} />
          </Field>
          <Field label="Starts">
            <TimeInput value={draft.start} onChange={(start) => setDraft({ ...draft, start })} />
          </Field>
          <Field label="Ends">
            <TimeInput value={draft.end} onChange={(end) => setDraft({ ...draft, end })} />
          </Field>
        </div>

        <Field label="Repeats">
          <Segmented
            value={rule.kind}
            options={[
              { value: 'weekly', label: 'Every week' },
              { value: 'once', label: 'Just once' },
            ]}
            onChange={(kind) =>
              setDraft({ ...draft, rule: kind === 'weekly' ? { kind, weekdays: [1, 2, 3, 4, 5] } : { kind, date: today } })
            }
          />
        </Field>

        {rule.kind === 'weekly' ? (
          <>
            <Field label="On">
              <WeekdayPicker value={rule.weekdays} onChange={(weekdays) => setDraft({ ...draft, rule: { ...rule, weekdays } })} />
            </Field>
            <div className="form-grid">
              <Field label="From (optional)" hint="e.g. start of semester">
                <DateInput value={rule.from ?? ''} onChange={(v) => setDraft({ ...draft, rule: { ...rule, from: v || undefined } })} />
              </Field>
              <Field label="Until (optional)" hint="e.g. end of semester">
                <DateInput value={rule.until ?? ''} onChange={(v) => setDraft({ ...draft, rule: { ...rule, until: v || undefined } })} />
              </Field>
            </div>
          </>
        ) : (
          <Field label="Date">
            <DateInput value={rule.date} onChange={(date) => setDraft({ ...draft, rule: { ...rule, date } })} />
          </Field>
        )}

        <Problems check={tried ? check : { errors: [], warnings: check.warnings }} />
        <div className="button-row">
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
