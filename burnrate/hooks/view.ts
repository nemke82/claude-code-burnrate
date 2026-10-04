/**
 * view.ts — what the band and the /burn pane say, as plain data: rows of
 * coloured text segments. Pure, so a test reads it without a surface.
 */
import type { Meter, Miss, PlanWindow, Reading, Sample } from '../types'
import { fmtTokens, hitRatio, windowLabel } from './meter'
import { fmtPace, paceOf } from './pace'
import type { Pace } from './pace'

export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }

export type Health = 'cold' | 'uncached' | 'miss' | 'warm' | 'partial'

/** How the cache treated a request: the band's colour and mark. */
export function health(s: Sample): Health {
  if (s.miss) return 'miss'
  if (s.read + s.write === 0) return 'uncached'
  if (s.n === 1) return 'cold'
  return hitRatio(s) >= 0.8 ? 'warm' : 'partial'
}

const MARK: Record<Health, string> = { cold: '○', uncached: '○', miss: '✖', warm: '●', partial: '▲' }
const COLOR: Record<Health, string | undefined> = { cold: undefined, uncached: undefined, miss: 'red', warm: 'green', partial: 'yellow' }

export function bar(ratio: number, width: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** 45s, 12m, 1h 5m, 2d 3h. */
export function fmtGap(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
  return h % 24 === 0 ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ${h % 24}h`
}

/** What is known about a miss, not why the cache lost it: a pause is stated, never called an expiry. */
export function missText(miss: Miss): string {
  if (miss.cause === 'model') return 'model changed'
  if (miss.cause === 'idle') return `after ${fmtGap(miss.gapMs)} idle`
  // neither a model change nor a pause: a changed prefix is the usual reason, not an observed one
  return 'likely prefix change'
}

/** `~81.3k`: a miss's rewrite is an estimate. */
export const fmtWaste = (tokens: number) => `~${fmtTokens(tokens)}`

const windowColor = (percent: number) => (percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : undefined)

function windowSeg(w: PlanWindow): Seg {
  const color = windowColor(w.percentUsed)
  const text = `${windowLabel(w)} ${Math.round(w.percentUsed)}%`
  return color ? { text, color, bold: true } : { text, dim: true }
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}es`}`

/** Drops the least important segments until the row fits: a higher `rank` goes first, the later of equals before the earlier. */
export function fit(ranked: readonly (readonly [Seg, number])[], columns: number): Seg[] {
  const kept = [...ranked]
  const width = () => kept.reduce((sum, [seg]) => sum + seg.text.length, 0) + Math.max(0, kept.length - 1)
  while (width() > columns) {
    const worst = Math.max(...kept.map(([, rank]) => rank))
    if (worst === 0) break
    kept.splice(kept.map(([, rank]) => rank).lastIndexOf(worst), 1)
  }
  return kept.map(([seg]) => seg)
}

type Paced = { w: PlanWindow; pace: Pace | undefined }

/** The windows with their paces, the one that fills before it resets first (soonest of several), then by share used. */
export function byUrgency(windows: readonly PlanWindow[], readings: readonly Reading[], now: number): Paced[] {
  const paced = windows.map(w => ({ w, pace: paceOf(readings, w, now) }))
  const due = (p: Paced) => (p.pace?.hitsLimit ? (p.pace.fullInMs ?? 0) : Infinity)
  return paced.sort((a, b) => due(a) - due(b) || b.w.percentUsed - a.w.percentUsed)
}

/** `full in 1h 16m`, red inside half an hour; nothing for a window that resets first. */
function limitSeg(p: Paced): Seg | undefined {
  if (p.w.percentUsed >= 100) return { text: 'limit reached', color: 'red', bold: true }
  if (!p.pace?.hitsLimit || p.pace.fullInMs === undefined) return undefined
  return { text: `full in ${fmtGap(p.pace.fullInMs)}`, color: p.pace.fullInMs < 30 * 60_000 ? 'red' : 'yellow', bold: true }
}

const isRising = (p: Paced) => p.pace !== undefined && p.pace.perHour >= 0.05

/**
 * The band: one row, the most urgent plan window first with its pace. In the
 * order a narrow terminal drops them: the session's miss count, the other
 * windows, the last miss's detail (its red mark stays) and the pace, the
 * cached share, then the warning that a window fills before it resets.
 */
export function bandSegs(meter: Meter, windows: readonly PlanWindow[], readings: readonly Reading[], now: number, columns: number): Seg[] {
  const name: Seg = { text: 'burnrate', color: 'cyan', bold: true }
  const last = meter.samples[meter.samples.length - 1]
  const [lead, ...others] = byUrgency(windows, readings, now)
  const plan: [Seg, number][] = []
  if (lead) {
    plan.push([windowSeg(lead.w), 1])
    if (isRising(lead)) plan.push([{ text: fmtPace(lead.pace?.perHour ?? 0, lead.w.kind), dim: true }, 3])
    const limit = limitSeg(lead)
    if (limit) plan.push([limit, 1])
  }
  for (const p of others) plan.push([windowSeg(p.w), 4])
  if (!last) return fit([[name, 0], ...plan, [{ text: 'waiting for the first request', dim: true }, 2]], columns)

  const state = health(last)
  const ranked: [Seg, number][] = [[{ text: MARK[state], color: COLOR[state], bold: true }, 0], [name, 0], ...plan]
  ranked.push([{ text: `${Math.round(hitRatio(last) * 100)}% cached`, color: COLOR[state] }, 2])

  const { misses, wasted } = meter.totals
  if (last.miss) ranked.push([{ text: `miss: ${missText(last.miss)}, ${fmtWaste(last.miss.wasted)} rewritten`, color: 'red' }, 3])
  if (misses > (last.miss ? 1 : 0)) ranked.push([{ text: `${plural(misses, 'miss')} ${fmtWaste(wasted)}`, dim: true }, 5])
  return fit(ranked, columns)
}

/** What the pane says of a window's pace: the rate, then where it leads. */
function paceSegs(p: Paced): Seg[] {
  if (!p.pace) return [{ text: 'pace: measuring', dim: true }]
  if (!isRising(p)) return [{ text: 'steady', dim: true }]
  const segs: Seg[] = [{ text: fmtPace(p.pace.perHour, p.w.kind) }]
  const limit = limitSeg(p)
  if (limit) segs.push(limit)
  else if (p.pace.atReset !== undefined) segs.push({ text: `~${Math.round(p.pace.atReset)}% at reset`, dim: true })
  return segs
}

const pad = (text: string, width: number) => text.padStart(width)

/** `resets in 2h 10m`, or nothing when the window names no reset or it has passed. */
export function resetText(w: PlanWindow, now: number): string {
  const at = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  return Number.isFinite(at) && at > now ? `resets in ${fmtGap(at - now)}` : ''
}

/** The /burn pane, row by row; an empty row is a blank line. The request table takes what `maxRows` leaves, three rows at least. */
export function paneRows(meter: Meter, windows: readonly PlanWindow[], readings: readonly Reading[], now: number, maxRows: number): Seg[][] {
  const t = meter.totals
  const prompt = t.read + t.write + t.fresh
  const rows: Seg[][] = []

  const summary = [`${t.requests} ${t.requests === 1 ? 'request' : 'requests'}`]
  if (prompt > 0) summary.push(`${Math.round((t.read / prompt) * 100)}% cached`)
  summary.push(`${fmtTokens(t.output)} output`)
  rows.push([{ text: 'Session', bold: true, color: 'cyan' }, { text: summary.join(' · ') }])
  rows.push([])

  rows.push([
    { text: 'Cache misses', bold: true, color: 'cyan' },
    t.misses === 0 ? { text: 'none', dim: true } : { text: `${t.misses} · ${fmtWaste(t.wasted)} tokens rewritten (estimate)`, color: 'yellow' },
  ])
  for (const s of meter.samples.filter(s => s.miss).slice(-5)) {
    const miss = s.miss
    if (!miss) continue
    const row: Seg[] = [
      { text: `  req ${pad(String(s.n), 3)}`, dim: true },
      { text: pad(fmtWaste(miss.wasted), 7), color: 'red', bold: true },
      { text: missText(miss) },
    ]
    if (miss.from) row.push({ text: `${miss.from} → ${s.model}`, dim: true })
    rows.push(row)
  }
  rows.push([])

  rows.push([{ text: 'Plan windows', bold: true, color: 'cyan' }, ...(windows.length === 0 ? [{ text: 'none reported (API key, or no response yet)', dim: true }] : [])])
  for (const p of byUrgency(windows, readings, now)) {
    const w = p.w
    const color = windowColor(w.percentUsed)
    const reset = resetText(w, now)
    rows.push([
      { text: `  ${windowLabel(w).padEnd(5)}`, dim: true },
      { text: bar(w.percentUsed / 100, 20), color: color ?? 'green' },
      { text: pad(`${Math.round(w.percentUsed)}%`, 4), bold: true, color },
      ...(reset ? [{ text: reset, dim: true }] : []),
      ...paceSegs(p),
    ])
  }
  rows.push([])

  rows.push([{ text: 'Recent requests', bold: true, color: 'cyan' }, ...(meter.samples.length === 0 ? [{ text: 'none yet', dim: true }] : [])])
  if (meter.samples.length > 0) {
    rows.push([{ text: `  ${pad('req', 5)} ${pad('read', 6)} ${pad('wrote', 6)} ${pad('new', 6)} ${pad('hit', 4)}`, dim: true }])
    // a blank and the legend come out of what is left
    for (const s of meter.samples.slice(-Math.max(3, maxRows - rows.length - 2))) {
      const state = health(s)
      rows.push([
        { text: `  ${pad(String(s.n), 5)}`, dim: true },
        { text: pad(fmtTokens(s.read), 6), color: 'green' },
        { text: pad(fmtTokens(s.write), 6), color: 'yellow' },
        { text: pad(fmtTokens(s.fresh), 6) },
        { text: pad(`${Math.round(hitRatio(s) * 100)}%`, 4), bold: true, color: COLOR[state] },
        ...(s.miss ? [{ text: missText(s.miss), color: 'red' }] : []),
      ])
    }
    rows.push([])
    rows.push([{ text: 'read: served by the cache · wrote: new cache entry · new: sent uncached', dim: true }])
  }
  return rows
}
