import { expect, test } from 'claude-code/testing'

import { EMPTY_METER, IDLE_MS, KEEP, bandLine, detectMiss, fmtTokens, hitRatio, record } from '../hooks/meter'
import type { Sample } from '../types'

const sample = (over: Partial<Sample> = {}): Sample => ({
  turnId: 't1',
  index: 0,
  model: 'claude-opus',
  startedAt: 0,
  read: 0,
  write: 0,
  fresh: 0,
  output: 0,
  ...over,
})

const warm = sample({ read: 80_000, write: 1_000, fresh: 300 })

test('a request that reads the previous prompt is not a miss', () => {
  const cur = sample({ startedAt: 10_000, read: 81_000, write: 900, fresh: 200 })
  expect(detectMiss(warm, cur)).toBeUndefined()
})

test('the first request, and one after an uncached request, have nothing to miss', () => {
  const cur = sample({ write: 50_000 })
  expect(detectMiss(undefined, cur)).toBeUndefined()
  expect(detectMiss(sample({ fresh: 900 }), cur)).toBeUndefined()
})

test('a prompt that shrank is a compaction, not a miss', () => {
  const cur = sample({ startedAt: 10_000, write: 20_000, fresh: 200 })
  expect(detectMiss(warm, cur)).toBeUndefined()
})

test('a rewrite names its cause: model, idle gap, then prefix', () => {
  const rewrite = { read: 0, write: 82_000, fresh: 300 }
  expect(detectMiss(warm, sample({ ...rewrite, startedAt: 10_000, model: 'claude-sonnet' }))?.cause).toBe('model')
  expect(detectMiss(warm, sample({ ...rewrite, startedAt: IDLE_MS + 1 }))?.cause).toBe('idle')
  expect(detectMiss(warm, sample({ ...rewrite, startedAt: 10_000 }))?.cause).toBe('prefix')
})

test('a miss wastes what the previous prompt had cached, never more', () => {
  const miss = detectMiss(warm, sample({ startedAt: 10_000, write: 95_000, fresh: 300 }))
  expect(miss?.wasted).toBe(81_300)
  expect(miss?.gapMs).toBe(10_000)
})

test('record sums every request and counts the misses', () => {
  let meter = record(EMPTY_METER, warm)
  meter = record(meter, sample({ startedAt: 10_000, read: 0, write: 82_000, fresh: 300, output: 50 }))
  expect(meter.samples.length).toBe(2)
  expect(meter.samples[1]?.miss?.cause).toBe('prefix')
  expect(meter.totals).toEqual({ requests: 2, read: 80_000, write: 83_000, fresh: 600, output: 50, misses: 1, wasted: 81_300 })
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

test('the band line', () => {
  expect(bandLine(EMPTY_METER, [])).toBe('waiting for the first request')
  const meter = record(record(EMPTY_METER, warm), sample({ startedAt: 10_000, write: 82_000, fresh: 300 }))
  const line = bandLine(meter, [
    { kind: 'five_hour', percentUsed: 23.4 },
    { kind: 'seven_day', percentUsed: 41 },
  ])
  expect(line).toBe('0% cached · 1 miss, 81.3k rewritten · 5h 23% · 7d 41%')
})
