import { useState, type ReactNode } from 'react'
import type { Check } from '../domain/setupValidation'
import { Problems, hasErrors } from './form'

/**
 * A list of rows where tapping a row opens an inline form (Save / Cancel / Delete),
 * and "Add" opens a blank one. Used by every setup section.
 */
export function EditableList<T extends { id: string }, D>({
  items,
  empty,
  addLabel,
  renderRow,
  renderForm,
  toDraft,
  newDraft,
  validate,
  onSave,
  onDelete,
}: {
  items: readonly T[]
  empty: ReactNode
  addLabel: string
  renderRow: (item: T) => ReactNode
  renderForm: (draft: D, setDraft: (d: D) => void) => ReactNode
  toDraft: (item: T) => D
  newDraft: () => D
  validate: (draft: D) => Check
  /** id is undefined for a new item. */
  onSave: (draft: D, id: string | undefined) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}) {
  // editing: null = nothing open, 'new' = adding, otherwise the id being edited
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<D | null>(null)
  const [tried, setTried] = useState(false)

  const open = (id: string | 'new', d: D) => {
    setEditing(id)
    setDraft(d)
    setTried(false)
  }
  const close = () => {
    setEditing(null)
    setDraft(null)
  }

  const form = (id: string | undefined) => {
    if (draft === null) return null
    const check = validate(draft)
    return (
      <div className="edit-form">
        {renderForm(draft, setDraft)}
        {/* errors only after the first Save attempt; warnings always */}
        <Problems check={tried ? check : { errors: [], warnings: check.warnings }} />
        <div className="button-row">
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              setTried(true)
              if (hasErrors(check)) return
              await onSave(draft, id)
              close()
            }}
          >
            Save
          </button>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          {id && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!window.confirm('Delete this?')) return
                await onDelete(id)
                close()
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="list">
      {items.length === 0 && editing !== 'new' && <p className="muted list-empty">{empty}</p>}
      {items.map((item) =>
        editing === item.id ? (
          <div key={item.id} className="list-item editing">
            {form(item.id)}
          </div>
        ) : (
          <button key={item.id} type="button" className="list-item" onClick={() => open(item.id, toDraft(item))}>
            {renderRow(item)}
            <span className="chevron" aria-hidden>
              ›
            </span>
          </button>
        ),
      )}
      {editing === 'new' ? (
        <div className="list-item editing">{form(undefined)}</div>
      ) : (
        <button type="button" className="list-add" onClick={() => open('new', newDraft())}>
          + {addLabel}
        </button>
      )}
    </div>
  )
}
