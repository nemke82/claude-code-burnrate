/**
 * burnrate — Claude Code mod (EARLY ACCESS)
 *
 * Skeleton: one row above the prompt. The meter itself (per-request cache
 * usage, miss cost, plan-window burn) lands in the next steps.
 */
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text bold color="cyan">burnrate</Text>
        <Text dimColor wrap="truncate-end">· waiting for the first request</Text>
      </Box>
    )
  })
}
