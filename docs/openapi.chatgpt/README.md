# Mastermind Custom GPT Actions

Use this guide to connect a Custom GPT to a reachable Mastermind endpoint.

## Schema and endpoint

Import `docs/openapi.chatgpt.json`, or fetch `/api/openapi` from the running
endpoint. New configurations should use:

```text
https://mastermind.prochat.tools/api/openapi
```

`https://workbench.prochat.tools/api/openapi` is retired and must not be used
for imports. A localhost URL is suitable for local inspection, but
ChatGPT-hosted Actions require the canonical HTTPS endpoint it can reach.

## Canonical operations

The schema contains exactly these five operations:

1. `getMastermindStatus` — health, source discovery, and resume state.
2. `readMastermindContext` — bounded files, symbols, search, and task context.
3. `applyMastermindFileChange` — guarded file changes and durable goal start.
4. `commitMastermindChanges` — explicit scoped Git commit.
5. `runMastermindCommand` — bounded commands and validation evidence.

Use the owner-configured Action Token. Each repository request must include an
exact enabled `sourceId`; never substitute a placeholder or silently switch
sources.

## Import workflow

1. Start Mastermind or configure an HTTPS endpoint you control.
2. Import the current schema in the Custom GPT Action editor.
3. Configure bearer authentication with the Action Token.
4. Apply `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
5. Test status and one exact read.
6. Test a write with `dryRun`.
7. Perform an approved write only after reviewing the scope.

Keep the five operations bounded. Larger objectives belong in Goal Mode with
durable state, packet scope, validation checkpoints, and resumable evidence.
Do not recreate the old retired agent routes in a new GPT configuration.
