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

// The shortest cache lifetime. After a longer pause the entry may have lapsed;
// the mod API does not say which lifetime the request asked for, so a miss
// past it is reported with the pause, not as an expiry.
export const IDLE_MS = 300_000

export const EMPTY_TOTALS: Totals = { requests: 0, read: 0, write: 0, fresh: 0, output: 0, misses: 0, wasted: 0 }

export const EMPTY_METER: Meter = { samples: [], totals: EMPTY_TOTALS }

export const promptTokens = (s: Pick<Sample, 'read' | 'write' | 'fresh'>) => s.read + s.write + s.fresh

/** Share of the prompt the cache served, 0 to 1; 0 for an empty prompt. */
export function hitRatio(s: Pick<Sample, 'read' | 'write' | 'fresh'>): number {
  const total = s.read + s.write + s.fresh
  return total === 0 ? 0 : s.read / total
}

// A request that leaves this share of the cached prefix unread, and writes it
// again, is a miss; less is the ordinary churn at the prompt's tail.
export const MISS_SHARE = 0.2

/**
 * The miss `cur` was, given the request before it; undefined when it was not
 * one. Judged on counts alone: what `prev` left cached that `cur` did not read
 * and wrote instead. A prompt that shrank (a /compact, a rewind) is left out:
 * its rewrite cannot be told from a lost cache. A request after an uncached
 * one had nothing to read.
 */
export function detectMiss(prev: Sample | undefined, cur: Omit<Sample, 'n' | 'miss'>): Miss | undefined {
  if (!prev) return undefined
  const cached = prev.read + prev.write
  if (cached === 0 || promptTokens(cur) < promptTokens(prev) * 0.7) return undefined
  const wasted = Math.min(cur.write, cached - cur.read)
  if (wasted < cached * MISS_SHARE) return undefined
  const gapMs = Math.max(0, cur.startedAt - prev.endedAt)
  if (cur.model !== prev.model) return { cause: 'model', wasted, gapMs, from: prev.model }
  return { cause: gapMs > IDLE_MS ? 'idle' : 'prefix', wasted, gapMs }
}

/** The meter with one more request: its miss worked out, the totals moved on. */
export function record(meter: Meter, raw: Omit<Sample, 'n' | 'miss'>): Meter {
  const miss = detectMiss(meter.samples[meter.samples.length - 1], raw)
  const t = meter.totals
  const n = t.requests + 1
  const sample: Sample = miss ? { ...raw, n, miss } : { ...raw, n }
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
