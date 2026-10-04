import { expect, test } from 'claude-code/testing'

import { EMPTY_METER, IDLE_MS, KEEP, detectMiss, fmtTokens, hitRatio, record } from '../hooks/meter'
import type { Sample } from '../types'

const sample = (over: Partial<Sample> = {}): Sample => ({
  n: 2,
  turnId: 't1',
  index: 0,
  model: 'claude-opus',
  startedAt: 0,
  endedAt: 0,
  read: 0,
  write: 0,
  fresh: 0,
  output: 0,
  ...over,
})

// leaves 81k cached; its response took 4s
const warm = sample({ endedAt: 4_000, read: 80_000, write: 1_000, fresh: 300 })

test('a request that reads the previous prompt is not a miss', () => {
  const cur = sample({ startedAt: 10_000, read: 81_000, write: 900, fresh: 200 })
  expect(detectMiss(warm, cur)).toBeUndefined()
})

test('the first request, and one after an uncached request, have nothing to miss', () => {
  const cur = sample({ write: 50_000 })
  expect(detectMiss(undefined, cur)).toBeUndefined()
  expect(detectMiss(sample({ fresh: 900 }), cur)).toBeUndefined()
})

test('a prompt that shrank is left out: its rewrite cannot be told from a lost cache', () => {
  const cur = sample({ startedAt: 10_000, write: 20_000, fresh: 200 })
  expect(detectMiss(warm, cur)).toBeUndefined()
})

test('a request that stops caching is uncached, not a miss', () => {
  expect(detectMiss(warm, sample({ startedAt: 10_000, fresh: 82_000 }))).toBeUndefined()
})

test('a partial miss counts what went unread, not everything written', () => {
  const prev = sample({ endedAt: 1_000, read: 90_000, write: 10_000 })
  // 60k of the cached 100k went unread; the other 10k written is new content
  expect(detectMiss(prev, sample({ startedAt: 2_000, read: 40_000, write: 70_000 }))?.wasted).toBe(60_000)
  // a read of just over half is still a miss
  expect(detectMiss(prev, sample({ startedAt: 2_000, read: 51_000, write: 55_000 }))?.wasted).toBe(49_000)
})

test('ordinary churn at the tail is under the threshold', () => {
  const prev = sample({ endedAt: 1_000, read: 90_000, write: 10_000 })
  expect(detectMiss(prev, sample({ startedAt: 2_000, read: 85_000, write: 20_000 }))).toBeUndefined()
  expect(detectMiss(prev, sample({ startedAt: 2_000, read: 80_000, write: 25_000 }))?.wasted).toBe(20_000)
})

test('the estimate never exceeds what was cached, nor what was written', () => {
  expect(detectMiss(warm, sample({ startedAt: 10_000, write: 95_000, fresh: 300 }))?.wasted).toBe(81_000)
  const prev = sample({ endedAt: 1_000, read: 90_000, write: 10_000 })
  expect(detectMiss(prev, sample({ startedAt: 2_000, read: 10_000, write: 30_000, fresh: 50_000 }))?.wasted).toBe(30_000)
})

test('a rewrite names what is known: a model change, a pause, else the prefix', () => {
  const rewrite = { read: 0, write: 82_000, fresh: 300 }
  const swapped = detectMiss(warm, sample({ ...rewrite, startedAt: 10_000, model: 'claude-sonnet' }))
  expect(swapped?.cause).toBe('model')
  expect(swapped?.from).toBe('claude-opus')
  expect(detectMiss(warm, sample({ ...rewrite, startedAt: 4_000 + IDLE_MS + 1 }))?.cause).toBe('idle')
  expect(detectMiss(warm, sample({ ...rewrite, startedAt: 10_000 }))?.cause).toBe('prefix')
})

test('the pause runs from the end of the previous response, so a long response is not idle time', () => {
  const slow = sample({ startedAt: 0, endedAt: 360_000, read: 80_000, write: 1_000, fresh: 300 })
  const miss = detectMiss(slow, sample({ startedAt: 361_000, write: 82_000, fresh: 300 }))
  expect(miss?.cause).toBe('prefix')
  expect(miss?.gapMs).toBe(1_000)
})

test('record sums every request and counts the misses', () => {
  let meter = record(EMPTY_METER, warm)
  meter = record(meter, sample({ startedAt: 10_000, endedAt: 12_000, read: 0, write: 82_000, fresh: 300, output: 50 }))
  expect(meter.samples.length).toBe(2)
  expect(meter.samples.map(s => s.n)).toEqual([1, 2])
  expect(meter.samples[1]?.miss?.cause).toBe('prefix')
  expect(meter.totals).toEqual({ requests: 2, read: 80_000, write: 83_000, fresh: 600, output: 50, misses: 1, wasted: 81_000 })
})

test('record keeps the last samples and still counts them all', () => {
  let meter = EMPTY_METER
  for (let i = 0; i < KEEP + 5; i++) meter = record(meter, sample({ index: i, read: 10 }))
  expect(meter.samples.length).toBe(KEEP)
  expect(meter.samples[0]?.index).toBe(5)
  expect(meter.totals.requests).toBe(KEEP + 5)
})

test('hitRatio and fmtTokens', () => {
  expect(hitRatio(sample())).toBe(0)
  expect(Math.round(hitRatio(warm) * 100)).toBe(98)
  expect([999, 1_000, 52_300, 150_000, 1_200_000].map(fmtTokens)).toEqual(['999', '1k', '52.3k', '150k', '1.2M'])
})
