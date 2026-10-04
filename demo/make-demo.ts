/**
 * Writes an asciinema recording (asciicast v2) of burnrate's row and /burn
 * pane to stdout, for `agg` to turn into a GIF:
 *
 *   npx tsx demo/make-demo.ts band > band.cast && agg band.cast assets/demo-band.gif
 *   npx tsx demo/make-demo.ts pane > pane.cast && agg pane.cast assets/demo-pane.gif
 *
 * The session is scripted; every line of the row and the pane comes from the
 * mod's own code (hooks/meter, hooks/pace, hooks/view), so the demo shows
 * what the mod draws for those numbers. The frame around them (caption,
 * prompt, pane border) is drawn here.
 */
import { EMPTY_METER, record } from '../burnrate/hooks/meter'
import { addReadings } from '../burnrate/hooks/pace'
import { bandSegs, paneRows } from '../burnrate/hooks/view'
import type { Seg } from '../burnrate/hooks/view'
import type { Meter, PlanWindow, Reading } from '../burnrate/types'

const which = process.argv[2] === 'pane' ? 'pane' : 'band'
const COLS = 92
const ROWS = which === 'pane' ? 24 : 7
const MIN = 60_000
const T0 = Date.parse('2026-10-04T09:00:00Z')

const CODE: Record<string, number> = { red: 31, green: 32, yellow: 33, cyan: 36 }
const sgr = (s: Seg) => {
  const codes = [...(s.bold ? [1] : []), ...(s.dim ? [2] : []), ...(s.color && CODE[s.color] ? [CODE[s.color]] : [])]
  return codes.length ? `\x1b[${codes.join(';')}m${s.text}\x1b[0m` : s.text
}
const line = (segs: readonly Seg[]) => segs.map(sgr).join(' ')
const plain = (segs: readonly Seg[]) => segs.map(s => s.text).join(' ')
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`

let meter: Meter = EMPTY_METER
let windows: PlanWindow[] = []
let readings: Reading[] = []
let now = T0
let n = 0
let isPaneOpen = false
let clock = 0
const events: string[] = []

function plan(five: number, seven: number) {
  windows = [
    { kind: 'five_hour', percentUsed: five, resetsAt: new Date(T0 + 200 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: seven, resetsAt: new Date(T0 + 92 * 60 * MIN).toISOString() },
  ]
  readings = addReadings(readings, windows, now)
}

function request(read: number, write: number, model = 'claude-opus-5-5') {
  meter = record(meter, { turnId: `t${n}`, index: n++, model, startedAt: now, endedAt: now + 4_000, read, write, fresh: 300, output: 420 })
  now += 5_000
}

function frame(caption: string, prompt = '', hold = 2.6) {
  const out: string[] = [`  ${dim(caption)}`, '']
  if (isPaneOpen) {
    const inner = COLS - 4
    out.push(dim(`╭${'─'.repeat(inner + 2)}╮`))
    for (const row of paneRows(meter, windows, readings, now, 16)) {
      out.push(`${dim('│')} ${line(row)}${' '.repeat(Math.max(0, inner - plain(row).length))} ${dim('│')}`)
    }
    out.push(dim(`╰${'─'.repeat(inner + 2)}╯`))
  }
  out.push(line(bandSegs(meter, windows, readings, now, COLS)))
  out.push(dim('─'.repeat(COLS)), `❯ ${prompt}`, dim('─'.repeat(COLS)))
  events.push(JSON.stringify([Number(clock.toFixed(2)), 'o', `\x1b[2J\x1b[H\x1b[?25l${out.join('\r\n')}`]))
  clock += hold
}

function type(caption: string, text: string) {
  for (let i = 1; i <= text.length; i++) frame(caption, text.slice(0, i), 0.12)
}

function story() {
  plan(17, 10)
  frame('A new session: burnrate shows where your plan windows stand')
  request(0, 52_000)
  frame('The first request writes the prompt cache')
  request(52_000, 1_200)
  request(53_200, 900)
  frame('The next ones read it back: 98% of the prompt came from cache')
  now += 10 * MIN
  plan(19, 10)
  request(54_100, 1_500)
  frame('After five minutes of history it knows your pace', '', 3.2)
  now += 30 * MIN
  plan(41, 11)
  request(55_600, 2_300)
  frame('Heavy work: at this pace the 5-hour window fills before it resets', '', 3.6)
  request(0, 58_200, 'claude-sonnet-5-5')
  frame('You switch model: the cache is written again, and burnrate says so', '', 3.6)
  request(58_200, 800, 'claude-sonnet-5-5')
  frame('Back to normal. The miss stays counted for the session', '', 3.2)
}

story()
if (which === 'pane') {
  events.length = 0
  clock = 0
  frame('Type /burn for the detail')
  type('Type /burn for the detail', '/burn')
  isPaneOpen = true
  frame('Session totals, each miss, plan windows with pace, and the last requests', '', 4.5)
  request(59_000, 1_100, 'claude-sonnet-5-5')
  frame('It updates as requests come in', '', 3)
  now += 12 * MIN
  plan(43, 11)
  request(0, 60_400, 'claude-sonnet-5-5')
  frame('A miss after a pause is reported with the pause, not called an expiry', '', 5)
}

console.log(JSON.stringify({ version: 2, width: COLS, height: ROWS, timestamp: Math.floor(T0 / 1000) }))
for (const e of events) console.log(e)
// hold the last frame before the loop restarts
console.log(JSON.stringify([Number((clock + 1.5).toFixed(2)), 'o', '']))
