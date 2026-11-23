import { useState } from 'react'
import { repos } from '../../db/repositories'
import type { CheckIn } from '../../db/types'
import { validateCheckIn } from '../../domain/log'

const LEVEL = { energy: ['Drained', 'Low', 'OK', 'Good', 'Great'], mood: ['Bad', 'Meh', 'OK', 'Good', 'Great'] } as const

/** Evening check-in (SPEC 4.1c): energy 1–5, mood 1–5, optional one-line note. One per day. */
export function CheckInCard({ date, existing, onSaved, onLater }: { date: string; existing?: CheckIn; onSaved?: () => void; onLater?: () => void }) {
  const [energy, setEnergy] = useState<number | undefined>(existing?.energy)
  const [mood, setMood] = useState<number | undefined>(existing?.mood)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string>()

  const save = async () => {
    const err = validateCheckIn({ energy: energy as CheckIn['energy'], mood: mood as CheckIn['mood'] })
    setError(err)
    if (err) return
    const c: CheckIn = { date, energy: energy as CheckIn['energy'], mood: mood as CheckIn['mood'] }
    if (note.trim()) c.note = note.trim().slice(0, 200)
    await repos.checkIns.put(c)
    onSaved?.()
  }

  const scale = (kind: 'energy' | 'mood', value: number | undefined, set: (n: number) => void) => (
    <div className="checkin-scale" role="radiogroup" aria-label={kind === 'energy' ? 'Energy' : 'Mood'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} className={value === n ? 'lvl on' : 'lvl'} onClick={() => set(n)}>
          <strong>{n}</strong>
          <span>{LEVEL[kind][n - 1]}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="card checkin">
      <div className="field" role="group" aria-labelledby="ci-energy">
        <span className="field-label" id="ci-energy">
          Energy today
        </span>
        {scale('energy', energy, setEnergy)}
      </div>
      <div className="field" role="group" aria-labelledby="ci-mood">
        <span className="field-label" id="ci-mood">
          Mood
        </span>
        {scale('mood', mood, setMood)}
      </div>
      <label className="field">
        <span className="field-label">One line about today (optional)</span>
        <input className="input" type="text" maxLength={200} value={note} placeholder="e.g. good focus in the afternoon" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="button-row">
        <button type="button" className="btn primary" onClick={() => void save()}>
          {existing ? 'Update' : 'Save check-in'}
        </button>
        {onLater && (
          <button type="button" className="btn link" onClick={onLater}>
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
