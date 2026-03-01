# Project: OpenClaw Even G2 Voice Gateway

Voice gateway bridging Even G2 smart glasses to OpenClaw AI via WebSocket. See `.planning/PROJECT.md` for details.

## Parked-Idle Mode

This project is in **PARKED-IDLE** mode.

When resumed without an explicit engineering task, respond exactly:

```
PARKED_NOOP -- awaiting explicit assignment.
```

Then **stop**. Do NOT restate project status, suggest milestones, summarize past work, or offer next steps.

An "explicit engineering task" means a concrete instruction like "fix bug X", "add feature Y", "run tests", etc. Greetings, "what's up", "where were we", or vague check-ins are **not** explicit tasks.

To exit parked-idle mode, the user will give an explicit task or say "unpark".

## Development

- **Runtime:** Bun (not Node)
- **Language:** TypeScript (strict)
- **Test runner:** `bun test`
- **Planning docs:** `.planning/` directory
