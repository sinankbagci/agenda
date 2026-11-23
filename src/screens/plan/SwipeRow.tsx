import { useRef, useState, type ReactNode } from 'react'

const ACTIONS_W = 168 // width of the revealed left-swipe buttons
const TRIGGER = 80 // how far a right swipe must go to count

/**
 * Horizontal swipe on a row (SPEC 4.1): swipe right → `onSwipeRight` (complete),
 * swipe left → reveal `actions` (part / skip). Vertical scrolling is left to the browser
 * (touch-action: pan-y), and a swipe never also counts as a tap.
 */
export function SwipeRow({
  children,
  actions,
  onSwipeRight,
  rightLabel = 'Done',
}: {
  children: ReactNode
  actions?: ReactNode
  onSwipeRight?: () => void
  rightLabel?: string
}) {
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // live gesture state in a ref: React state can lag behind fast pointer events
  const g = useRef<{ x: number; y: number; decided: boolean; horizontal: boolean; dx: number } | null>(null)
  const suppressClick = useRef(false)

  const reset = () => {
    setDx(0)
    setOpen(false)
  }

  return (
    <div className="swipe">
      {onSwipeRight && (
        <div className="swipe-under swipe-done" style={{ opacity: dx > 10 ? Math.min(1, dx / TRIGGER) : 0 }} aria-hidden>
          ✓ {rightLabel}
        </div>
      )}
      {actions && (
        <div className="swipe-under swipe-actions" style={{ visibility: dx < 0 || open ? 'visible' : 'hidden' }}>
          <div onClick={reset}>{actions}</div>
        </div>
      )}
      <div
        className={dragging ? 'swipe-front dragging' : 'swipe-front'}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          g.current = { x: e.clientX, y: e.clientY, decided: false, horizontal: false, dx: open ? -ACTIONS_W : 0 }
        }}
        onPointerMove={(e) => {
          const s = g.current
          if (!s) return
          const mx = e.clientX - s.x
          const my = e.clientY - s.y
          if (!s.decided && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
            s.decided = true
            s.horizontal = Math.abs(mx) > Math.abs(my)
            if (s.horizontal) {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragging(true)
            }
          }
          if (!s.horizontal) return
          const base = open ? -ACTIONS_W : 0
          const min = actions ? -ACTIONS_W - 24 : 0
          const max = onSwipeRight ? 140 : 0
          s.dx = Math.max(min, Math.min(max, base + mx))
          setDx(s.dx)
        }}
        onPointerUp={() => {
          const s = g.current
          g.current = null
          setDragging(false)
          if (!s?.horizontal) return
          suppressClick.current = true
          if (onSwipeRight && s.dx >= TRIGGER) {
            reset()
            onSwipeRight()
          } else if (actions && s.dx < -ACTIONS_W / 2) {
            setDx(-ACTIONS_W)
            setOpen(true)
          } else reset()
        }}
        onPointerCancel={() => {
          g.current = null
          setDragging(false)
          if (!open) setDx(0)
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            // the click that ends a swipe: swallow it, keep the row as the swipe left it
            e.preventDefault()
            e.stopPropagation()
            suppressClick.current = false
          } else if (open) {
            // a later tap on an open row just closes it
            e.preventDefault()
            e.stopPropagation()
            reset()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
