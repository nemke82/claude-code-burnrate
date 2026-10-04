import { expect, test } from 'claude-code/testing'

import { EMPTY_METER, record } from '../hooks/meter'
import { bandSegs, bar, fit, fmtGap, health, paneRows, resetText } from '../hooks/view'
import type { Seg } from '../hooks/view'
import type { Meter, Sample } from '../types'

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
  expect(texts(bandSegs(EMPTY_METER, [], null, 120))).toEqual(['burnrate', 'waiting for the first request'])
})

test('a warm band: money first, then the cached share and the tightest window', () => {
  const segs = bandSegs(feed({}, { startedAt: 1_000 }), PLAN, 1.5, 120)
  expect(texts(segs)).toEqual(['●', 'burnrate', '$1.50', '98% cached', '7d 95%', '5h 23%'])
  expect(segs[0]?.color).toBe('green')
  expect(segs.find(s => s.text === '7d 95%')?.color).toBe('red')
})

test('the band names a miss while it is the last request, then keeps a short count', () => {
  const missed = feed({}, { startedAt: 1_000, read: 0, write: 82_000, model: 'claude-sonnet' })
  expect(texts(bandSegs(missed, [], null, 120))).toEqual(['✖', 'burnrate', '0% cached', 'miss: model changed, ~81k rewritten'])

  const after = record(missed, raw({ startedAt: 2_000, read: 82_000, write: 500, model: 'claude-sonnet' }))
  expect(texts(bandSegs(after, [], null, 120))).toEqual(['●', 'burnrate', '99% cached', '1 miss ~81k'])

  const again = record(after, raw({ startedAt: 2_000 + 900_000, read: 0, write: 83_000, model: 'claude-sonnet' }))
  expect(texts(bandSegs(again, [], null, 120))).toEqual(['✖', 'burnrate', '0% cached', 'miss: after 15m idle, ~82.5k rewritten', '2 misses ~164k'])
})

test('a narrow band keeps the cost and the cached share, and fits', () => {
  const missed = feed({}, { startedAt: 1_000 }, { startedAt: 2_000, read: 0, write: 82_000 }, { startedAt: 3_000, read: 0, write: 83_000, model: 'claude-sonnet' })
  for (const columns of [120, 80, 60, 40, 30]) {
    const segs = bandSegs(missed, PLAN, 12.34, columns)
    expect(width(segs) <= columns).toBe(true)
    expect(texts(segs)).toContain('$12.34')
    expect(texts(segs)).toContain('0% cached')
  }
  expect(texts(bandSegs(missed, PLAN, 12.34, 60))).toEqual(['✖', 'burnrate', '$12.34', '0% cached', '7d 95%'])
  expect(texts(bandSegs(missed, PLAN, 12.34, 30))).toEqual(['✖', 'burnrate', '$12.34', '0% cached'])
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
  const lines = paneRows(EMPTY_METER, [], null, 0, 24).map(r => texts(r).join(' '))
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
  const lines = paneRows(meter, [{ kind: 'seven_day', percentUsed: 41 }], 2, 0, 24).map(r => texts(r).join(' '))
  expect(lines[0]).toBe('Session 3 requests · 66% cached · 30 output · $2.00')
  expect(lines).toContain('Cache misses 1 · ~81k tokens rewritten (estimate)')
  expect(lines).toContain('  req   2    ~81k model changed claude-opus → claude-sonnet')
  expect(lines).toContain(`  7d    ${bar(0.41, 20)}  41%`)
})

test('the request table takes the rows the pane has left, three at least', () => {
  const meter = feed(...Array.from({ length: 30 }, (_, i) => ({ startedAt: i * 1_000 })))
  const table = (maxRows: number) => paneRows(meter, PLAN, null, 0, maxRows).filter(r => /^\s+\d+$/.test(r[0]?.text ?? ''))
  expect(paneRows(meter, PLAN, null, 0, 24).length).toBe(24)
  expect(table(24).length).toBe(12)
  expect(table(8).length).toBe(3)
})
