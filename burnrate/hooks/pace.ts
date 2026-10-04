/**
 * pace.ts — how fast a plan window is filling, from its own readings over
 * time. Pure: no `$`, no engine.
 *
 * The engine reports a window's `percentUsed` after each turn and when it
 * moves a whole point. A pace is the rise over the recent past, measured up
 * to now, so it falls off by itself while nothing is being sent.
 */
import type { PlanWindow, Reading } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Readings older than this are dropped. */
export const KEEP_MS = 6 * HOUR

/** How far back a pace looks: half an hour for the five-hour window, the kept history for the rest. */
export const lookbackMs = (kind: string) => (kind === 'five_hour' ? 30 * MINUTE : KEEP_MS)

/** Less history than this and the pace is not stated: five minutes for the five-hour window, an hour for the slower ones. */
export const minSpanMs = (kind: string) => (kind === 'five_hour' ? 5 * MINUTE : HOUR)

// The engine reports a window as it moves a whole point, so a rise of one
// point may be rounding. A warning needs more than that behind it.
export const MIN_RISE = 2

export type Pace = {
  /** points of the window per hour; 0 when it did not move */
  perHour: number
  /** ms until the window is full at this pace; absent when it is not rising */
  fullInMs?: number
  /** where the window stands when it resets, at this pace, capped at 100; absent without a reset time */
  atReset?: number
  /** true when it fills before it resets: the reading that matters */
  hitsLimit: boolean
}

/**
 * The history with the windows' readings at `now`: one per window whose share
 * moved. A share that fell means the window reset, and its earlier readings
 * go; so do those past KEEP_MS.
 */
export function addReadings(history: readonly Reading[], windows: readonly PlanWindow[], now: number): Reading[] {
  let next = history.filter(r => now - r.at <= KEEP_MS)
  for (const w of windows) {
    const mine = next.filter(r => r.kind === w.kind)
    const last = mine[mine.length - 1]
    if (last && w.percentUsed < last.percentUsed) next = next.filter(r => r.kind !== w.kind)
    else if (last && w.percentUsed === last.percentUsed) continue
    next = [...next, { kind: w.kind, at: now, percentUsed: w.percentUsed }]
  }
  return next
}

/** The window's pace at `now`; undefined until `minSpanMs` of its history exists. */
export function paceOf(history: readonly Reading[], w: PlanWindow, now: number): Pace | undefined {
  const mine = history.filter(r => r.kind === w.kind && r.at <= now)
  const first = mine[0]
  if (!first) return undefined
  const from = now - lookbackMs(w.kind)
  // where the window stood when the lookback began: the last reading before it, carried forward
  const before = mine.filter(r => r.at <= from)
  const base = before.length > 0 ? { at: from, percentUsed: (before[before.length - 1] as Reading).percentUsed } : first
  const span = now - base.at
  if (span < minSpanMs(w.kind)) return undefined

  const rise = w.percentUsed - base.percentUsed
  const perHour = Math.max(0, (rise / span) * HOUR)
  const resetAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const untilReset = Number.isFinite(resetAt) && resetAt > now ? resetAt - now : undefined
  const pace: Pace = { perHour, hitsLimit: false }
  if (untilReset !== undefined) pace.atReset = Math.min(100, w.percentUsed + (perHour * untilReset) / HOUR)
  if (perHour > 0 && w.percentUsed < 100) {
    pace.fullInMs = ((100 - w.percentUsed) / perHour) * HOUR
    pace.hitsLimit = rise >= MIN_RISE && untilReset !== undefined && pace.fullInMs < untilReset
  }
  return pace
}

/** `+12%/h`, or per day for the seven-day window; one decimal under ten. */
export function fmtPace(perHour: number, kind: string): string {
  const [rate, unit] = kind === 'seven_day' ? [perHour * 24, 'd'] : [perHour, 'h']
  const text = rate >= 10 ? String(Math.round(rate)) : rate.toFixed(1).replace(/\.0$/, '')
  return `+${text}%/${unit}`
}
