# burnrate

Live cost meter for Claude Code: see what each prompt-cache miss cost you and how fast you're burning your plan window.

> **Status: skeleton.** The mod loads and draws one row above the prompt. The meter itself is not built yet.

## Planned

- **Miss cost:** what each cache miss rewrote, why it missed, and a running total for the session.
- **Plan burn:** your five-hour and seven-day windows beside it.
- **Quiet by default:** one line above the prompt, details in `/burn`.

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
