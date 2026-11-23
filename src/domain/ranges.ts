/**
 * Half-open minute ranges [start, end) within a day (0–1440). Pure helpers.
 * All functions return new arrays, sorted by start, without empty ranges.
 */
export interface Range {
  start: number
  end: number
}

export const DAY_START = 0
export const DAY_END = 1440

export const length = (r: Range) => r.end - r.start
export const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end
export const totalLength = (rs: readonly Range[]) => rs.reduce((s, r) => s + length(r), 0)

/** Sort and merge overlapping or touching ranges. */
export function union(rs: readonly Range[]): Range[] {
  const sorted = rs.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ start: r.start, end: r.end })
  }
  return out
}

/** Parts of `r` not covered by any of `cut`. Keeps the extra fields of `r` on every piece. */
export function subtractFrom<T extends Range>(r: T, cut: readonly Range[]): T[] {
  let pieces: T[] = [{ ...r }]
  for (const c of union(cut)) {
    const next: T[] = []
    for (const p of pieces) {
      if (!overlaps(p, c)) {
        next.push(p)
        continue
      }
      if (c.start > p.start) next.push({ ...p, end: c.start })
      if (c.end < p.end) next.push({ ...p, start: c.end })
    }
    pieces = next
  }
  return pieces.filter((p) => p.end > p.start)
}

/** Every range in `rs` minus `cut`, keeping extra fields. */
export function subtract<T extends Range>(rs: readonly T[], cut: readonly Range[]): T[] {
  return rs.flatMap((r) => subtractFrom(r, cut)).sort((a, b) => a.start - b.start)
}

/** Parts of `rs` that lie inside `within`, keeping extra fields of `rs`. */
export function intersect<T extends Range>(rs: readonly T[], within: readonly Range[]): T[] {
  const w = union(within)
  const out: T[] = []
  for (const r of rs) {
    for (const x of w) {
      const start = Math.max(r.start, x.start)
      const end = Math.min(r.end, x.end)
      if (end > start) out.push({ ...r, start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Complement of `rs` inside [from, to). */
export function gaps(rs: readonly Range[], from = DAY_START, to = DAY_END): Range[] {
  return subtractFrom({ start: from, end: to }, rs)
}
