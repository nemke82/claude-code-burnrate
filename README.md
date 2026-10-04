# burnrate

Live cost meter for Claude Code: your session's cost, your prompt-cache misses with an estimate of the tokens each rewrote, and how fast you're burning your plan window.

> **Status: early.** The meter works and is tested, but it has not been tuned against many real sessions yet.

```
● burnrate $1.50 98% cached 7d 41% 5h 23%
✖ burnrate $1.92 0% cached miss: model changed, ~81k rewritten 7d 41% 5h 24%
```

## What it shows

- **The row above the prompt:** the session's cost first, then how much of the last request the cache served, a miss when there was one, and your plan windows, tightest first. A window turns yellow at 70% and red at 90%. On a narrow terminal the detail goes and the cost stays.
- **`/burn`:** a pane with the session's totals, each miss with what is known about it, the plan windows with their reset times, and the last requests one by one. `/burn close` shuts it.

## What a miss is, and what it is not

A miss is a request that left a fifth or more of the cached prompt unread and wrote it again. burnrate says what it can tell about it:

| Shown as | What it means |
| --- | --- |
| model changed | the request went to a different model than the one before |
| after 12m idle | more than five minutes passed between the previous response and this request |
| likely prefix change | neither of the above. The usual reason is that something ahead of the conversation changed (effort, tools, system prompt, `CLAUDE.md`), but burnrate cannot see that |

The limits:

- **Token counts are estimates**, shown with `~`. The API reports how many tokens were read and written, not which ones, so new content can hide inside a rewrite.
- **No dollar figure per miss.** The session cost is the engine's own total; the mod API gives no per-model pricing to split it by.
- **A pause is not an expiry.** The mod API does not say whether a request asked for the 5-minute or the 1-hour cache, so burnrate reports the pause and leaves the conclusion to you.
- **A prompt that shrank is left out.** After `/compact` or a rewind the rewrite is expected, and it cannot be told from a lost cache.
- **Only the main conversation is counted.** Subagents have caches of their own.

## Install

```
/plugin marketplace add nemke82/claude-code-burnrate
/plugin install burnrate@burnrate
```

Mods are early access: start Claude Code with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (2.1.259 or later). The mod API may change between releases.

## Develop

```sh
claude plugin validate burnrate
claude plugin test burnrate
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir burnrate   # hot reloads on save
```

## Licence

MIT
