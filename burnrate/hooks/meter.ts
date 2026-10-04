/**
 * meter.ts — the pure half of burnrate: no `$`, no engine.
 *
 * A request's prompt is `fresh` (uncached) + `read` (served by the cache) +
 * `write` (written to it). A healthy request reads nearly all of the previous
 * prompt and writes only the new tail; a miss writes the prefix again.
 */
import type { Meter, Miss, PlanWindow, Sample, Totals } from '../types'

/** Samples kept for the per-request view; the totals count every request. */
export const KEEP = 200

// The shortest cache lifetime. A longer gap may have lapsed the entry; the mod
// API does not say which lifetime the request asked for.
export const IDLE_MS = 300_000

export const EMPTY_TOTALS: Totals = { requests: 0, read: 0, write: 0, fresh: 0, output: 0, misses: 0, wasted: 0 }

export const EMPTY_METER: Meter = { samples: [], totals: EMPTY_TOTALS }

export const promptTokens = (s: Sample) => s.read + s.write + s.fresh

/** Share of the prompt the cache served, 0 to 1; 0 for an empty prompt. */
export function hitRatio(s: Pick<Sample, 'read' | 'write' | 'fresh'>): number {
  const total = s.read + s.write + s.fresh
  return total === 0 ? 0 : s.read / total
}

/**
 * The miss `cur` was, given the request before it; undefined when it was not
 * one. A prompt that shrank is a /compact, not a miss, and a request after an
 * uncached one had nothing to read.
 */
export function detectMiss(prev: Sample | undefined, cur: Sample): Miss | undefined {
  if (!prev || prev.read + prev.write === 0) return undefined
  const before = promptTokens(prev)
  if (promptTokens(cur) < before * 0.7) return undefined
  if (cur.write === 0 || cur.read >= before * 0.5) return undefined
  const gapMs = cur.startedAt - prev.startedAt
  const cause = cur.model !== prev.model ? 'model' : gapMs > IDLE_MS ? 'idle' : 'prefix'
  return { cause, wasted: Math.min(cur.write, before), gapMs }
}

/** The meter with one more request: its miss worked out, the totals moved on. */
export function record(meter: Meter, raw: Omit<Sample, 'miss'>): Meter {
  const miss = detectMiss(meter.samples[meter.samples.length - 1], raw)
  const sample: Sample = miss ? { ...raw, miss } : raw
  const t = meter.totals
  return {
    samples: [...meter.samples, sample].slice(-KEEP),
    totals: {
      requests: t.requests + 1,
      read: t.read + sample.read,
      write: t.write + sample.write,
      fresh: t.fresh + sample.fresh,
      output: t.output + sample.output,
      misses: t.misses + (miss ? 1 : 0),
      wasted: t.wasted + (miss?.wasted ?? 0),
    },
  }
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const windowLabel = (w: PlanWindow) => WINDOW_LABEL[w.kind] ?? w.kind

/** The band's one line, until the UI step gives it a layout of its own. */
export function bandLine(meter: Meter, windows: readonly PlanWindow[]): string {
  const last = meter.samples[meter.samples.length - 1]
  if (!last) return 'waiting for the first request'
  const { misses, wasted } = meter.totals
  const parts = [
    `${Math.round(hitRatio(last) * 100)}% cached`,
    misses === 0 ? 'no misses' : `${misses} ${misses === 1 ? 'miss' : 'misses'}, ${fmtTokens(wasted)} rewritten`,
    ...windows.map(w => `${windowLabel(w)} ${Math.round(w.percentUsed)}%`),
  ]
  return parts.join(' · ')
}
