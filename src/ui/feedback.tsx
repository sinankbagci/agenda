/** Completion feedback: a soft chime (Web Audio, no files) and a confetti burst. */
import type { CSSProperties } from 'react'

let ctx: AudioContext | undefined

function audio(): AudioContext | undefined {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return undefined
  ctx ??= new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call from a tap (e.g. Focus "Start") so later sounds without a tap are allowed on iOS. */
export function unlockAudio() {
  try {
    const c = audio()
    if (!c) return
    const g = c.createGain()
    g.gain.value = 0
    const o = c.createOscillator()
    o.connect(g).connect(c.destination)
    o.start()
    o.stop(c.currentTime + 0.01)
  } catch {
    // optional
  }
}

/** One soft bell for Focus phase changes (work ↔ break). */
export function playBell(high = false) {
  try {
    const c = audio()
    if (!c) return
    const t = c.currentTime
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = high ? 880 : 587.33
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.14, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 1.25)
  } catch {
    // optional
  }
}

/** Two soft notes. Must be called from a tap (iOS only allows audio after a user gesture). */
export function playChime() {
  try {
    const ctx = audio()
    if (!ctx) return
    const t0 = ctx.currentTime
    for (const [i, freq] of [659.25, 987.77].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = t0 + i * 0.11
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.55)
    }
  } catch {
    // sound is optional
  }
}

/** Small burst of dots in the goal colour; CSS animates it, the parent removes it after ~1 s. */
export function Burst({ color }: { color: string }) {
  return (
    <span className="burst" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          style={{ '--a': `${(360 / 14) * i}deg`, '--d': `${28 + (i % 3) * 10}px`, background: i % 2 ? color : 'var(--ok)' } as CSSProperties}
        />
      ))}
    </span>
  )
}
