/**
 * burnrate — Claude Code mod (EARLY ACCESS)
 *
 * A quota and prompt-cache monitor: the account's rate-limit windows
 * (`session.measure`), every main-loop request's cache usage (`turn.step`)
 * and the misses among them, kept in `$.state`. No dollars: the engine's
 * figure is list price, which is not what a subscription or a custom
 * contract pays.
 *
 *   - a row above the prompt: the plan window that matters most with its pace
 *     (see pace.ts), the last request and the misses (estimates, see detectMiss)
 *   - `/burn`: a pane with the session's totals, each miss and the last requests
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_METER, record } from './meter'
import { addReadings } from './pace'
import { bandSegs, paneRows } from './view'
import type { Meter, PlanWindow, Reading } from '../types'

const PANE = 'burnrate'
const COMMAND = 'burn'

const meter = atom({ plugin: 'burnrate', key: 'meter' } as const, EMPTY_METER as Meter)
const windows = atom({ plugin: 'burnrate', key: 'windows' } as const, [] as PlanWindow[])
const readings = atom({ plugin: 'burnrate', key: 'readings' } as const, [] as Reading[])

// the windows as they stand, and one more point of each one's history
async function measure($: EngineInterface, limits: readonly PlanWindow[]) {
  const now = limits.map(w => ({ ...w }))
  const at = await $.clock.now()
  await update($, windows, () => now)
  await update($, readings, history => addReadings(history, now, at))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // the engine pushes the windows only as they move: start from where they stand
    const usage = await $.session.usage().catch(() => undefined)
    if (usage && usage.rateLimits.length > 0) await measure($, usage.rateLimits)

    await $.command.register({
      name: COMMAND,
      description: 'Cache misses, plan windows and the last requests of this session (close shuts the pane)',
      argumentHint: '[close]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'burnrate pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'burnrate', rows: 24 })

    return { text: `burnrate pane opened. /${COMMAND} close shuts it.` }
  })

  // each main-loop request: what the cache did with it (a subagent has a prefix of its own)
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const startedAt = await $.clock.now()
    const r = yield* next(e)
    const usage = r.usage
    if (usage) {
      const endedAt = await $.clock.now()
      await update($, meter, m =>
        record(m, {
          turnId: e.turnId,
          index: e.index,
          model: usage.model || e.model,
          startedAt,
          endedAt,
          read: usage.cache_read_input_tokens,
          write: usage.cache_creation_input_tokens,
          fresh: usage.input_tokens,
          output: usage.output_tokens,
        }),
      )
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e.rateLimits)
    return next(e)
  })

  // /clear starts a new conversation in the same session: its cache is a new one
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, meter, () => EMPTY_METER)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const segs = bandSegs(await read($, meter), await read($, windows), await read($, readings), await $.clock.now(), e.props.bodyColumns)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" columnGap={1}>
        {segs.map(s => (
          <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate-end">{s.text}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // HTML collapses runs of spaces; a no-break space keeps the columns
    const sp = (t: string) => (e.surface === 'terminal' ? t : t.replace(/ /g, ' '))
    const rows = paneRows(await read($, meter), await read($, windows), await read($, readings), await $.clock.now(), e.props.scroll.bodyRows)

    return (
      <Box flexDirection="column">
        {rows.map(row =>
          row.length === 0 ? (
            <Text> </Text>
          ) : (
            <Box flexDirection="row" columnGap={1}>
              {row.map(s => (
                <Text color={s.color} bold={s.bold} dimColor={s.dim}>{sp(s.text)}</Text>
              ))}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
