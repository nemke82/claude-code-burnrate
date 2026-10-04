import { expect, test } from 'claude-code/testing'

import { EMPTY_METER, record } from '../hooks/meter'
import { bandSegs, bar, fit, fmtGap, health, paneRows, resetText } from '../hooks/view'
import type { Seg } from '../hooks/view'
import type { Meter, Reading, Sample } from '../types'

type Raw = Omit<Sample, 'n' | 'miss'>

const raw = (over: Partial<Raw> = {}): Raw => ({
  turnId: 't1',
  index: 0,
  model: 'claude-opus',
  startedAt: 0,
  endedAt: over.startedAt ?? 0,
  read: 80_000,
  write: 1_000,
  fresh: 300,
  output: 10,
  ...over,
})

const feed = (...steps: Partial<Raw>[]): Meter => steps.reduce<Meter>((m, s) => record(m, raw(s)), EMPTY_METER)

const texts = (segs: readonly Seg[]) => segs.map(s => s.text)
const last = (m: Meter) => m.samples[m.samples.length - 1] as Sample
const width = (segs: readonly Seg[]) => texts(segs).join(' ').length

const PLAN = [
  { kind: 'five_hour', percentUsed: 23.4 },
  { kind: 'seven_day', percentUsed: 95 },
]

test('health: cold, warm, partial, uncached, miss', () => {
  expect(health(last(feed({ read: 0, write: 50_000 })))).toBe('cold')
  expect(health(last(feed({}, { startedAt: 1_000 })))).toBe('warm')
  expect(health(last(feed({}, { startedAt: 1_000, read: 70_000, write: 30_000 })))).toBe('partial')
  expect(health(last(feed({}, { startedAt: 1_000, read: 0, write: 0, fresh: 81_000 })))).toBe('uncached')
  expect(health(last(feed({}, { startedAt: 1_000, read: 0, write: 82_000 })))).toBe('miss')
})

test('the band before any request', () => {
  expect(texts(bandSegs(EMPTY_METER, [], [], 0, 120))).toEqual(['burnrate', 'waiting for the first request'])
  expect(texts(bandSegs(EMPTY_METER, PLAN, [], 0, 120))).toEqual(['burnrate', '7d 95%', '5h 23%', 'waiting for the first request'])
})

test('a warm band: the tightest window first, then the looser, then the cached share', () => {
  const segs = bandSegs(feed({}, { startedAt: 1_000 }), PLAN, [], 0, 120)
  expect(texts(segs)).toEqual(['●', 'burnrate', '7d 95%', '5h 23%', '98% cached'])
  expect(segs[0]?.color).toBe('green')
  expect(segs.find(s => s.text === '7d 95%')?.color).toBe('red')
})

test('the band names a miss while it is the last request, then keeps a short count', () => {
  const missed = feed({}, { startedAt: 1_000, read: 0, write: 82_000, model: 'claude-sonnet' })
  expect(texts(bandSegs(missed, [], [], 0, 120))).toEqual(['✖', 'burnrate', '0% cached', 'miss: model changed, ~81k rewritten'])

  const after = record(missed, raw({ startedAt: 2_000, read: 82_000, write: 500, model: 'claude-sonnet' }))
  expect(texts(bandSegs(after, [], [], 0, 120))).toEqual(['●', 'burnrate', '99% cached', '1 miss ~81k'])

  const again = record(after, raw({ startedAt: 2_000 + 900_000, read: 0, write: 83_000, model: 'claude-sonnet' }))
  expect(texts(bandSegs(again, [], [], 0, 120))).toEqual(['✖', 'burnrate', '0% cached', 'miss: after 15m idle, ~82.5k rewritten', '2 misses ~164k'])
})

test('a narrow band keeps the tightest window, and fits', () => {
  const missed = feed({}, { startedAt: 1_000 }, { startedAt: 2_000, read: 0, write: 82_000 }, { startedAt: 3_000, read: 0, write: 83_000, model: 'claude-sonnet' })
  for (const columns of [120, 80, 60, 40, 20]) {
    const segs = bandSegs(missed, PLAN, [], 0, columns)
    expect(width(segs) <= columns).toBe(true)
    expect(texts(segs)).toContain('7d 95%')
  }
  expect(texts(bandSegs(missed, PLAN, [], 0, 120))).toEqual(['✖', 'burnrate', '7d 95%', '5h 23%', '0% cached', 'miss: model changed, ~82k rewritten', '2 misses ~163k'])
  expect(texts(bandSegs(missed, PLAN, [], 0, 60))).toEqual(['✖', 'burnrate', '7d 95%', '0% cached'])
  expect(texts(bandSegs(missed, PLAN, [], 0, 20))).toEqual(['✖', 'burnrate', '7d 95%'])
})

test('fit drops the highest rank first, the later of equals before the earlier, and never rank 0', () => {
  const seg = (text: string): Seg => ({ text })
  const ranked = [[seg('aaaa'), 0], [seg('bbbb'), 2], [seg('cccc'), 1], [seg('dddd'), 2]] as const
  expect(texts(fit(ranked, 19))).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd'])
  expect(texts(fit(ranked, 14))).toEqual(['aaaa', 'bbbb', 'cccc'])
  expect(texts(fit(ranked, 9))).toEqual(['aaaa', 'cccc'])
  expect(texts(fit(ranked, 2))).toEqual(['aaaa'])
})

test('fmtGap and resetText', () => {
  expect([45_000, 720_000, 3_900_000, 7_200_000, 183_600_000].map(fmtGap)).toEqual(['45s', '12m', '1h 5m', '2h', '2d 3h'])
  const now = Date.parse('2026-10-04T10:00:00Z')
  expect(resetText({ kind: 'five_hour', percentUsed: 1, resetsAt: '2026-10-04T12:10:00Z' }, now)).toBe('resets in 2h 10m')
  expect(resetText({ kind: 'five_hour', percentUsed: 1, resetsAt: '2026-10-04T09:00:00Z' }, now)).toBe('')
  expect(resetText({ kind: 'five_hour', percentUsed: 1 }, now)).toBe('')
})

test('the pane before any request', () => {
  const lines = paneRows(EMPTY_METER, [], [], 0, 24).map(r => texts(r).join(' '))
  expect(lines).toEqual([
    'Session 0 requests · 0 output',
    '',
    'Cache misses none',
    '',
    'Plan windows none reported (API key, or no response yet)',
    '',
    'Recent requests none yet',
  ])
})

test('the pane lists each miss with what is known of it, marked as an estimate', () => {
  const meter = feed({}, { startedAt: 1_000, read: 0, write: 82_000, model: 'claude-sonnet' }, { startedAt: 2_000, read: 82_000, write: 500, model: 'claude-sonnet' })
  const lines = paneRows(meter, [{ kind: 'seven_day', percentUsed: 41 }], [], 0, 24).map(r => texts(r).join(' '))
  expect(lines[0]).toBe('Session 3 requests · 66% cached · 30 output')
  expect(lines).toContain('Cache misses 1 · ~81k tokens rewritten (estimate)')
  expect(lines).toContain('  req   2    ~81k model changed claude-opus → claude-sonnet')
  expect(lines).toContain(`  7d    ${bar(0.41, 20)}  41% pace: measuring`)
})

test('the request table takes the rows the pane has left, three at least', () => {
  const meter = feed(...Array.from({ length: 30 }, (_, i) => ({ startedAt: i * 1_000 })))
  const table = (maxRows: number) => paneRows(meter, PLAN, [], 0, maxRows).filter(r => /^\s+\d+$/.test(r[0]?.text ?? ''))
  expect(paneRows(meter, PLAN, [], 0, 24).length).toBe(24)
  expect(table(24).length).toBe(12)
  expect(table(8).length).toBe(3)
})

const T0 = Date.parse('2026-10-04T10:00:00Z')
const MIN = 60_000
const FIVE = { kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-04T13:00:00Z' }
const SEVEN = { kind: 'seven_day', percentUsed: 80, resetsAt: '2026-10-07T10:00:00Z' }
// the five-hour window rose 15 points in the last half hour; the seven-day one 1 point
const RISING: Reading[] = [
  { kind: 'five_hour', at: T0 - 30 * MIN, percentUsed: 47 },
  { kind: 'seven_day', at: T0 - 30 * MIN, percentUsed: 79 },
  { kind: 'five_hour', at: T0, percentUsed: 62 },
  { kind: 'seven_day', at: T0, percentUsed: 80 },
]

test('the band leads with the window that fills before it resets, its pace and when', () => {
  const segs = bandSegs(feed({}, { startedAt: 1_000 }), [SEVEN, FIVE], RISING, T0, 120)
  expect(texts(segs)).toEqual(['●', 'burnrate', '5h 62%', '+30%/h', 'full in 1h 16m', '7d 80%', '98% cached'])
  expect(segs.find(s => s.text === 'full in 1h 16m')?.color).toBe('yellow')
})

test('a narrow band keeps the warning longest', () => {
  const meter = feed({}, { startedAt: 1_000 })
  expect(texts(bandSegs(meter, [SEVEN, FIVE], RISING, T0, 40))).toEqual(['●', 'burnrate', '5h 62%', 'full in 1h 16m'])
  expect(texts(bandSegs(meter, [SEVEN, FIVE], RISING, T0, 24))).toEqual(['●', 'burnrate', '5h 62%'])
})

test('a window on pace to reset first gets its rate and no warning', () => {
  const slow: Reading[] = [{ kind: 'five_hour', at: T0 - 30 * MIN, percentUsed: 60 }]
  expect(texts(bandSegs(EMPTY_METER, [FIVE], slow, T0, 120))).toEqual(['burnrate', '5h 62%', '+4%/h', 'waiting for the first request'])
})

test('the pane states each window\'s pace and where it leads', () => {
  const lines = paneRows(EMPTY_METER, [SEVEN, FIVE], RISING, T0, 24).map(r => texts(r).join(' '))
  expect(lines).toContain(`  5h    ${bar(0.62, 20)}  62% resets in 3h +30%/h full in 1h 16m`)
  // one point in half an hour is too little history for the seven-day window
  expect(lines).toContain(`  7d    ${bar(0.8, 20)}  80% resets in 3d pace: measuring`)
  const idle: Reading[] = [{ kind: 'five_hour', at: T0 - 60 * MIN, percentUsed: 62 }]
  expect(paneRows(EMPTY_METER, [FIVE], idle, T0, 24).map(r => texts(r).join(' '))).toContain(`  5h    ${bar(0.62, 20)}  62% resets in 3h steady`)
  const slow: Reading[] = [{ kind: 'five_hour', at: T0 - 30 * MIN, percentUsed: 60 }]
  expect(paneRows(EMPTY_METER, [FIVE], slow, T0, 24).map(r => texts(r).join(' '))).toContain(`  5h    ${bar(0.62, 20)}  62% resets in 3h +4%/h ~74% at reset`)
})
