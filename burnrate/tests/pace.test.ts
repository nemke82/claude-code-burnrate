import { expect, test } from 'claude-code/testing'

import { KEEP_MS, addReadings, fmtPace, minSpanMs, paceOf } from '../hooks/pace'
import type { Reading } from '../types'

const MIN = 60_000
const T0 = Date.parse('2026-10-04T10:00:00Z')
const five = (percentUsed: number, resetsAt = '2026-10-04T13:00:00Z') => ({ kind: 'five_hour', percentUsed, resetsAt })
const at = (minutes: number, percentUsed: number, kind = 'five_hour'): Reading => ({ kind, at: T0 + minutes * MIN, percentUsed })

test('a reading is added only when the window moved', () => {
  let history = addReadings([], [five(10)], T0)
  history = addReadings(history, [five(10)], T0 + MIN)
  history = addReadings(history, [five(11)], T0 + 2 * MIN)
  expect(history).toEqual([at(0, 10), at(2, 11)])
})

test('a share that fell is a reset: the window starts its history over, the others keep theirs', () => {
  const history = [at(0, 90), at(0, 40, 'seven_day'), at(10, 95)]
  expect(addReadings(history, [five(2), { kind: 'seven_day', percentUsed: 41 }], T0 + 20 * MIN)).toEqual([at(0, 40, 'seven_day'), at(20, 2), at(20, 41, 'seven_day')])
})

test('readings past the kept history are dropped', () => {
  const history = addReadings([at(0, 10)], [five(20)], T0 + KEEP_MS + MIN)
  expect(history).toEqual([{ kind: 'five_hour', at: T0 + KEEP_MS + MIN, percentUsed: 20 }])
})

test('no pace without history, nor from too little of it: five minutes, an hour for the slower windows', () => {
  expect(paceOf([], five(10), T0)).toBeUndefined()
  expect(paceOf([at(0, 10)], five(12), T0 + minSpanMs('five_hour') - 1)).toBeUndefined()
  expect(paceOf([at(0, 10)], five(12), T0 + 5 * MIN)?.perHour).toBe(24)
  const seven = { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-07T10:00:00Z' }
  expect(paceOf([at(0, 10, 'seven_day')], seven, T0 + 59 * MIN)).toBeUndefined()
  expect(Math.round(paceOf([at(0, 10, 'seven_day')], seven, T0 + 60 * MIN)?.perHour ?? 0)).toBe(2)
})

test('a rise of one point is not enough for a warning', () => {
  // 98% to 99% in ten minutes would fill in ten more, long before the reset
  const pace = paceOf([at(-10, 98)], five(99), T0)
  expect(Math.round(pace?.perHour ?? 0)).toBe(6)
  expect(pace?.hitsLimit).toBe(false)
  expect(paceOf([at(-10, 97)], five(99), T0)?.hitsLimit).toBe(true)
})

test('a pace that fills the window before it resets', () => {
  // 47% to 62% in half an hour: 30 points an hour, 38 to go, three hours to the reset
  const pace = paceOf([at(-30, 47)], five(62), T0)
  expect(pace?.perHour).toBe(30)
  expect(Math.round((pace?.fullInMs ?? 0) / MIN)).toBe(76)
  expect(pace?.hitsLimit).toBe(true)
  expect(pace?.atReset).toBe(100)
})

test('a pace the reset beats', () => {
  const pace = paceOf([at(-30, 60)], five(62), T0)
  expect(Math.round((pace?.perHour ?? 0) * 100) / 100).toBe(4)
  expect(pace?.hitsLimit).toBe(false)
  expect(Math.round(pace?.atReset ?? 0)).toBe(74)
})

test('the pace falls off while nothing is sent', () => {
  const history = [at(-30, 47), at(0, 62)]
  expect(paceOf(history, five(62), T0)?.perHour).toBe(30)
  // a quarter of an hour on, the reading before the lookback stands for its start
  expect(paceOf(history, five(62), T0 + 15 * MIN)?.perHour).toBe(30)
  // past the lookback the rise is behind it: steady
  expect(paceOf(history, five(62), T0 + 31 * MIN)?.perHour).toBe(0)
  expect(paceOf(history, five(62), T0 + 31 * MIN)?.fullInMs).toBeUndefined()
})

test('without a reset time there is a rate and a time to full, but no warning', () => {
  const pace = paceOf([at(-30, 47)], { kind: 'five_hour', percentUsed: 62 }, T0)
  expect(pace?.perHour).toBe(30)
  expect(pace?.hitsLimit).toBe(false)
  expect(pace?.atReset).toBeUndefined()
})

test('a full window has no time to full', () => {
  const pace = paceOf([at(-30, 90)], five(100), T0)
  expect(pace?.fullInMs).toBeUndefined()
  expect(pace?.hitsLimit).toBe(false)
})

test('fmtPace: per hour, per day for the seven-day window, one decimal under ten', () => {
  expect(fmtPace(30, 'five_hour')).toBe('+30%/h')
  expect(fmtPace(4, 'five_hour')).toBe('+4%/h')
  expect(fmtPace(1.26, 'five_hour')).toBe('+1.3%/h')
  expect(fmtPace(0.5, 'seven_day')).toBe('+12%/d')
})
