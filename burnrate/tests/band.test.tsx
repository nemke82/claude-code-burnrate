import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

const BAND = {
  plugin: 'burnrate',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const usage = (read: number, write: number, fresh: number): TurnUsage => ({
  model: 'claude-opus',
  input_tokens: fresh,
  output_tokens: 10,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

// stands for the API: answers each step with the next usage queued
function answerSteps(on: On, queue: (TurnUsage | null)[]) {
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: queue.shift() ?? null }
  })
}

async function step($: Engine, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // no chunks: the result is all the mod reads
  }
  await stream.result
}

test('the band draws on the terminal and the desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /waiting for the first request/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band yields to a survey', async ($, on) => {
  // stands for the engine's own drawing, which nothing else answers in a test
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /burnrate/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /survey/ })).toBeDefined()
  await ui.unmount()
})

test('requests, a miss and the plan windows reach the band', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  answerSteps(on, [usage(80_000, 1_000, 300), usage(0, 82_000, 300)])
  on('session.measure', async ($, e) => ({ changed: [...e.changed] }))

  await step($, 0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /98% cached/ })).toBeDefined()

  await clock.advance(10_000)
  await step($, 1)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.4 },
      { kind: 'seven_day', percentUsed: 41 },
    ],
    changed: ['rateLimits'],
  })
  expect(await ui.find({ type: 'Text', text: /miss: likely prefix change, ~81k rewritten/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h 23%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d 41%/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent request and one without usage are left out', async ($, on) => {
  mock.clock(on)
  answerSteps(on, [usage(50_000, 500, 100), null])

  await step($, 0, 'agent-1')
  await step($, 1)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /waiting for the first request/ })).toBeDefined()
  await ui.unmount()
})

test('/clear starts the meter over', async ($, on) => {
  mock.clock(on)
  answerSteps(on, [usage(80_000, 1_000, 300)])
  on('session.end', async ($, e) => ({ sessionId: e.sessionId }))

  await step($, 0)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /waiting for the first request/ })).toBeDefined()
  await ui.unmount()
})

const PANE = {
  plugin: 'burnrate',
  component: 'Pane',
  requestId: 'burnrate',
  props: {
    title: 'burnrate',
    isFocused: false,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

test('the /burn pane lists the miss, the windows and the requests on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00Z') })
  answerSteps(on, [usage(80_000, 1_000, 300), usage(0, 82_000, 300)])
  on('session.measure', async ($, e) => ({ changed: [...e.changed] }))

  await step($, 0)
  await clock.advance(10_000)
  await step($, 1)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-04T12:10:10Z' }],
    changed: ['rateLimits'],
  })

  // a surface other than the terminal draws no-break spaces: \s matches both
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /2\srequests\s·\s49%\scached/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\s·\s~81k\stokens\srewritten\s\(estimate\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets\sin\s2h\s10m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sent\suncached/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/burn opens the pane and /burn close shuts it', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', async ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const run = (args: string) =>
    $.command.run({ command: 'burn', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  expect((await run(''))?.text).toMatch(/opened/)
  expect((await run(' Close '))?.text).toMatch(/closed/)
  expect(opened).toEqual(['burnrate'])
  expect(closed).toEqual(['burnrate'])
})
