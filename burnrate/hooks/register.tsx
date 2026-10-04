/**
 * burnrate — Claude Code mod (EARLY ACCESS)
 *
 * Data layer: every main-loop request's cache usage (`turn.step`) and the
 * account's rate-limit windows and session cost (`session.measure`), kept in
 * `$.state`. One row above the prompt reads them back; the meter's real
 * layout and `/burn` land in the next steps.
 */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { EMPTY_METER, bandLine, record } from './meter'
import type { Meter, PlanWindow } from '../types'

const meter = atom({ plugin: 'burnrate', key: 'meter' } as const, EMPTY_METER as Meter)
const windows = atom({ plugin: 'burnrate', key: 'windows' } as const, [] as PlanWindow[])
const costUsd = atom({ plugin: 'burnrate', key: 'costUsd' } as const, null as number | null)

export const register: Register = on => {
  // each main-loop request: what the cache did with it (a subagent has a prefix of its own)
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const startedAt = await $.clock.now()
    const r = yield* next(e)
    const usage = r.usage
    if (usage) {
      await update($, meter, m =>
        record(m, {
          turnId: e.turnId,
          index: e.index,
          model: usage.model || e.model,
          startedAt,
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
    const now = e.rateLimits.map(w => ({ ...w }))
    await update($, windows, () => now)
    const usd = e.cost?.usd ?? null
    await update($, costUsd, () => usd)
    return next(e)
  })

  // /clear starts a new conversation in the same session: its cache is a new one
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, meter, () => EMPTY_METER)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const line = bandLine(await read($, meter), await read($, windows))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text bold color="cyan">burnrate</Text>
        <Text dimColor wrap="truncate-end">{`· ${line}`}</Text>
      </Box>
    )
  })
}
