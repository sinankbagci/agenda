import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { repos } from '../../db/repositories'
import { TEMPLATES, normalizeGoal, previewGoal, toDraft, validateGoal, type GoalDraft } from '../../domain/goals'
import { Problems, Segmented, hasErrors } from '../../ui/form'
import { GoalForm } from './GoalForm'
import { TemplatePicker } from './TemplatePicker'

/**
 * /goals/new            → template picker
 * /goals/new?template=x → form pre-filled from the template
 * /goals/:id            → edit
 * `base` lets onboarding reuse this at /onboarding/goal.
 */
export function GoalEditScreen({ base = '/goals' }: { base?: string }) {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const templateKey = params.get('template')
  const today = format(new Date(), 'yyyy-MM-dd')

  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [missing, setMissing] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    setTried(false)
    if (isNew) {
      const t = TEMPLATES.find((x) => x.key === templateKey)
      setDraft(t ? t.make(today) : null)
      return
    }
    repos.goals.get(id!).then((g) => (g ? setDraft(toDraft(g)) : setMissing(true)))
  }, [id, isNew, templateKey]) // `today` only matters when the screen opens

  const back = () => navigate(-1)
  const header = (title: string) => (
    <>
      <button type="button" className="back" onClick={back}>
        ‹ Back
      </button>
      <h1>{title}</h1>
    </>
  )

  if (missing) return <section className="screen">{header('Goal not found')}</section>

  if (isNew && !draft) {
    return (
      <section className="screen">
        {header('New goal')}
        <p className="muted intro">Pick a starting point — you can change everything on the next screen.</p>
        <TemplatePicker base={`${base}/new`} />
      </section>
    )
  }
  if (!draft) return null

  const check = validateGoal(draft, today)
  const preview = previewGoal(draft, today)

  async function save() {
    setTried(true)
    if (hasErrors(check) || !draft) return
    const clean = normalizeGoal(draft)
    if (isNew) await repos.goals.add({ ...clean, createdAt: Date.now() })
    else {
      const existing = await repos.goals.get(id!)
      await repos.goals.put({ ...clean, id: id!, createdAt: existing?.createdAt ?? Date.now() })
    }
    navigate(-1)
  }

  async function remove() {
    if (!window.confirm(`Delete “${draft!.name}”? Its planned sessions are removed; finished sessions stay in your history.`)) return
    await repos.goals.remove(id!)
    navigate(-1)
  }

  return (
    <section className="screen goal-edit">
      {header(isNew ? 'New goal' : draft.name || 'Edit goal')}
      {!isNew && (
        <div className="card status-card">
          <Segmented
            value={draft.active ? 'active' : 'paused'}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
            onChange={(v) => setDraft({ ...draft, active: v === 'active' })}
          />
          <span className="muted">{draft.active ? 'Planned into your days.' : 'Not planned until you resume it.'}</span>
        </div>
      )}
      <GoalForm draft={draft} set={setDraft} today={today} isNew={isNew} />
      <div className="form-footer">
        {preview && <p className="preview">{preview}</p>}
        <Problems check={tried ? check : { errors: [], warnings: check.warnings }} />
        <div className="button-row">
          <button type="button" className="btn primary" onClick={save}>
            {isNew ? 'Add goal' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={back}>
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
