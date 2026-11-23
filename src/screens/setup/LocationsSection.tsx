import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import type { Location } from '../../db/types'
import type { Check } from '../../domain/setupValidation'
import { EditableList } from '../../ui/EditableList'
import { Field, LocationSelect, NumberInput, TextInput, useSettings } from '../../ui/form'

type Draft = { name: string }

export function LocationsSection() {
  const locations = useLiveQuery(() => repos.locations.all(), [])
  const travel = useLiveQuery(() => repos.travelTimes.all(), [])
  const settings = useSettings()
  if (!locations || !travel || !settings) return null

  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name))
  const validate = (d: Draft, id?: string): Check => {
    const errors: string[] = []
    const name = d.name.trim()
    if (!name) errors.push('Give the place a name.')
    else if (locations.some((l) => l.id !== id && l.name.trim().toLowerCase() === name.toLowerCase()))
      errors.push('You already have a place with that name.')
    return { errors, warnings: [] }
  }
  const minutes = (a: string, b: string) => travel.find((t) => t.fromId === a && t.toId === b)?.minutes
  const pairs: [Location, Location][] = []
  sorted.forEach((a, i) => sorted.slice(i + 1).forEach((b) => pairs.push([a, b])))

  return (
    <>
      <EditableList<Location, Draft>
        items={sorted}
        empty="No places yet. Add the places you move between, e.g. Home, Campus, Gym, Library."
        addLabel="Add place"
        renderRow={(l) => (
          <span className="row-main">
            <strong>{l.name}</strong>
            {settings.homeLocationId === l.id && <span className="badge">Home</span>}
          </span>
        )}
        toDraft={(l) => ({ name: l.name })}
        newDraft={() => ({ name: '' })}
        validate={(d) => validate(d)}
        onSave={async (d, id) => {
          const name = d.name.trim()
          if (id) return repos.locations.update(id, { name })
          const created = await repos.locations.add({ name })
          // first place, or one called "Home", becomes home by default
          if (!settings.homeLocationId && (locations.length === 0 || /^home$/i.test(name))) {
            await repos.settings.update({ homeLocationId: created.id })
          }
        }}
        onDelete={(id) => repos.locations.remove(id)}
        renderForm={(d, set) => (
          <div className="form-grid">
            <Field label="Name">
              <TextInput value={d.name} placeholder="Gym" onChange={(name) => set({ name })} />
            </Field>
          </div>
        )}
      />

      {locations.length > 0 && (
        <div className="card">
          <Field label="Home" hint="Where your day starts and ends.">
            <LocationSelect
              value={settings.homeLocationId}
              emptyLabel="Not set"
              onChange={(homeLocationId) => repos.settings.update({ homeLocationId })}
            />
          </Field>
        </div>
      )}

      {pairs.length > 0 && (
        <>
          <h3>Travel times</h3>
          <p className="muted">One way, in minutes. The same time is used in both directions.</p>
          <div className="card travel-table">
            {pairs.map(([a, b]) => {
              const value = minutes(a.id, b.id)
              return (
                <div key={`${a.id}-${b.id}`} className="travel-row">
                  <span>
                    {a.name} ↔ {b.name}
                  </span>
                  <NumberInput
                    value={value ?? NaN}
                    min={0}
                    suffix="min"
                    onChange={(m) => {
                      if (Number.isFinite(m) && m >= 0) void repos.travelTimes.set(a.id, b.id, Math.round(m))
                    }}
                  />
                </div>
              )
            })}
          </div>
          {pairs.some(([a, b]) => minutes(a.id, b.id) === undefined) && (
            <p className="warning">Fill in every travel time so the planner can add travel blocks.</p>
          )}
        </>
      )}
    </>
  )
}
