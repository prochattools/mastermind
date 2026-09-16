# ChatGPT-first Mastermind workflow

Mastermind keeps ChatGPT as the conversation and reasoning surface while the
local runtime owns source access, policy, execution, evidence, and durable
state.

## The normal loop

```text
ChatGPT understands the request
  -> Mastermind locks an exact source
  -> bounded context is read
  -> a guarded change or command is approved
  -> local validation produces evidence
  -> Git records an explicit commit when requested
```

The Custom GPT contract contains five operations:

- `getMastermindStatus`
- `readMastermindContext`
- `applyMastermindFileChange`
- `commitMastermindChanges`
- `runMastermindCommand`

The same durable goal and packet model is available from the native macOS
application and local runtime. The UI surface changes; the source lock,
policy, validation, and Git boundaries do not.

## Quick work

For a focused question or small edit, discover the source only when needed,
read the exact context, use a dry run for an unfamiliar change, then validate
the result. Keep the response compact and report what was actually proven.

## Goal work

For a feature, refactor, or documentation pass, use a bounded Goal Mode packet.
Declare the outcome, scope, constraints, non-goals, stop conditions, validation,
and commit intent. Mastermind persists checkpoints so a new conversation can
resume without treating chat history as the source of truth.

## Product boundary

Mastermind Local is the public local runtime, dashboard, CLI, native macOS
surface, and Custom GPT contract. It does not require a second model API,
unrestricted shell access, or automatic push. Optional context providers and
external executors are adapters and must degrade visibly when unavailable.
