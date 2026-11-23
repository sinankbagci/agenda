import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { repos } from '../../db/repositories'
import { describeFixedRule } from '../setup/FixedProgramSection'

/** Tap on a 🔒 block in the day view: one-off events can be edited or deleted right here. */
export function FixedSheet({ blockId, onClose, onDeleted }: { blockId: string; onClose: () => void; onDeleted: (date: string | undefined) => void }) {
  const navigate = useNavigate()
  const block = useLiveQuery(() => repos.fixedBlocks.get(blockId), [blockId])
  const place = useLiveQuery(() => (block?.locationId ? repos.locations.get(block.locationId) : Promise.resolve(undefined)), [block?.locationId])
  if (!block) return null
  const once = block.rule.kind === 'once'
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={block.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <h2 className="sheet-title">🔒 {block.title}</h2>
        <p className="muted sheet-sub">
          {block.start}–{block.end} · {describeFixedRule(block.rule)}
          {place ? ` · ${place.name}` : ''}
        </p>
        <p className="muted small">{once ? 'A one-off event: your plan moves around it.' : 'Part of your weekly fixed program.'}</p>
        <div className="button-row sheet-footer">
          <button type="button" className="btn primary" onClick={() => navigate(`/settings/fixed/${block.id}`)}>
            {once ? 'Edit event' : 'Edit in fixed program'}
          </button>
          {once && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!window.confirm(`Delete “${block.title}”?`)) return
                await repos.fixedBlocks.remove(block.id)
                onDeleted(block.rule.kind === 'once' ? block.rule.date : undefined)
              }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
