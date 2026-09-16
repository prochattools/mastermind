# Mastermind architecture

Mastermind keeps reasoning, local execution, and durable source state in
separate layers.

```text
ChatGPT or another reasoning client
  -> bounded five-action transport
  -> local Mastermind runtime
      -> source registry and index
      -> context broker
      -> policy-checked file changes
      -> bounded command runner
      -> validation and evidence store
      -> explicit Git adapter
  -> user's repository, folder, or knowledge source
```

## Public action layer

The public Custom GPT schema has five operations:

- `getMastermindStatus` reads health, source discovery, and resumable state.
- `readMastermindContext` returns bounded files, ranges, symbols, search, or
  task-context evidence.
- `applyMastermindFileChange` performs a guarded change or starts a bounded
  durable goal packet.
- `commitMastermindChanges` creates an explicit commit from approved paths.
- `runMastermindCommand` runs a bounded command or reads validation evidence.

Requests are authenticated, source-scoped, and bounded by action deadlines and
payload budgets. The schema is intentionally small so it remains usable from
Custom GPT Actions and other clients.

## Sources and context

A source is a user-owned local root with an exact identity, configuration, and
health/index state. The runtime can manage multiple sources and Git worktrees.
An action must carry the exact source ID; dashboard active context never
silently changes the scope of a remote action.

Context retrieval is progressive. A client can prepare task context, read exact
paths, inspect a range or symbol, or perform a bounded search. Cached graph or
index metadata helps navigation but must be checked against the source before
mutation.

## Quick and durable work

Quick Mode uses a small number of direct operations for focused work. Goal Mode
stores a bounded goal, scope, constraints, reads, changes, validation, and
commit intent. It returns compact checkpoints and can resume after a client or
process interruption.

Durability belongs to Mastermind and the repository, not to conversation
history. A conversation can disappear without destroying the run state or the
files already verified in the workspace.

## Local adapters

The dashboard, CLI, native macOS app, and Custom GPT transport are projections
over the same local control plane. Optional index/context providers and external
executors are adapters. If an optional provider is absent or stale, the core
must return a visible warning and retain a safe baseline.

The native macOS ingress is local at `127.0.0.1:3154`. The native GUI uses the
owner-local helper channel; it is not a second command engine.
