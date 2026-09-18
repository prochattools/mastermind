# Troubleshoot Mastermind

Start with the smallest diagnostic that answers the current question. Avoid
repeating mutations when a status or evidence lookup can reconcile the state.

## Custom GPT cannot connect

1. Confirm the configured server is reachable over HTTPS.
2. Confirm the schema uses `https://mastermind.prochat.tools` or another
   endpoint you control.
3. Confirm bearer authentication uses the owner-configured Action Token.
4. Open `/health` and `/api/openapi` from the endpoint.
5. Re-import the current schema after an operation contract change.

The former compatibility hostname `https://workbench.prochat.tools` is retired.
Re-import the schema with the canonical Mastermind server URL instead.

## No source is available

Run the local status/doctor path, register the source, and wait for source
health/indexing to settle. Use `getMastermindStatus` with `include=sources`
only when discovery is needed. Do not use `default`, `workspace`, `current`, or
`repo` as a source ID.

## Context is stale or too broad

Use one exact source, then narrow the read to a task, path, range, symbol, or
specific search pattern. Cached navigation data can be stale. Re-read the
exact file before a write and reduce the requested byte/match limits when the
action returns a bounded-result warning.

## A write is refused

Read the policy reason. Common causes are an unconfirmed consequential change,
an unsafe path, a stale source head, an invalid patch match, or a scope outside
the durable goal. Use `dryRun` for a write you do not yet understand. Do not
bypass the policy by switching to an unscoped command.

## A validation result is missing

Use the returned validation job ID or result reference with
`runMastermindCommand` status. Request a bounded stdout/stderr page using the
opaque cursor when more output exists. Do not submit a duplicate job merely
because the original HTTP response was lost.

## Native macOS is unhealthy

From the repository root, run:

```bash
pnpm macos:status
pnpm macos:doctor
```

The expected local ingress is `127.0.0.1:3154`. If the helper or portable host
is unavailable, use the controlled lifecycle restart/upgrade command and then
run status again. The native GUI is macOS-only; use the dashboard or CLI on
other platforms.
