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
An action must carry the exact source ID; menu-bar or dashboard context never
silently changes the scope of a remote action. Repository discovery and index
freshness are automatic in the normal native companion path; manual source
administration remains an advanced/support capability.

Context retrieval is progressive. A client can prepare task context, read exact
paths, inspect a range or symbol, or perform a bounded search. Cached graph or
index metadata helps navigation but must be checked against the source before
mutation.

### Source index freshness

The ordinary source-index path is state-driven rather than elapsed-time-only:

```text
Git/worktree change
  -> bounded observation of HEAD, branch, meaningful status paths, and policy
  -> freshness decision and proven changed-path delta
  -> per-source debounced queue
  -> bounded independent maintenance worker
  -> durable index generation/revision/retry state
  -> readiness and freshness metadata on context/read/mutation surfaces
```

An index is fresh only when its indexed revision, canonical source identity,
meaningful worktree identity, and scan policy/schema binding match the current
observation. Proven deltas use the incremental indexer; policy drift, branch or
identity changes, missing revisions, corrupt/unknown state, and unsupported
deltas use the bounded full builder. Generated/cache/lock noise is excluded
from worktree freshness identity, while meaningful tracked, untracked, and
deleted changes remain deterministic signals. Read-only context may carry a
stale warning and use the bounded filesystem fallback; mutation, validation,
and Git-sensitive command paths require fresh context.

## Quick and durable work

Quick Mode uses a small number of direct operations for focused work. Goal Mode
stores a bounded goal, scope, constraints, reads, changes, validation, and
commit intent. It returns compact checkpoints and can resume after a client or
process interruption.

Durability belongs to Mastermind and the repository, not to conversation
history. A conversation can disappear without destroying the run state or the
files already verified in the workspace.

## Local adapters

The native macOS menu-bar companion is the normal local projection. The
dashboard and CLI are advanced/support projections, and Custom GPT remains the
normal conversation and initiation surface. All project over the same local
control plane. Optional index/context providers and external executors are
adapters. If an optional provider is absent or stale, the core must return a
visible warning and retain a safe baseline.

The native macOS ingress is local at `127.0.0.1:3154`. The native GUI uses the
owner-local helper channel; it is not a second command engine.
