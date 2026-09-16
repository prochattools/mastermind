# Mastermind safety boundaries

Mastermind is guarded local tooling. It is not unrestricted terminal access and
it does not silently turn a conversational request into an unreviewed deploy.

## Authority

- Use only the owner-configured Action Token for Custom GPT Actions.
- Resolve one exact enabled `sourceId` before repository work.
- Keep the source locked until the user explicitly changes it.
- Treat dashboard active context as UI state, not remote authorization.

## Reads and context

Reads are bounded by path, result count, bytes, and action deadlines. Search
results and cached indexes are navigation evidence. Before editing, verify the
exact source file and current content.

## Writes

File changes use repository-relative paths and a guarded policy. Dry runs are
available for unfamiliar paths. The runtime verifies writes and records the
result. Protected boundaries include secrets, environment files, private keys,
Git metadata, vendor output, and other unsafe system or generated paths.

Deletes, moves, and other consequential changes may require explicit user
confirmation and a backend-issued confirmation token.

## Commands

`runMastermindCommand` is an owner-scoped, bounded command boundary. It is not a
general-purpose shell tunnel. Commands are constrained to the selected source,
redacted where necessary, and returned with bounded output and evidence. A
validation job is reconciled by its persisted result reference rather than
submitted again after a lost response.

## Git

Commits require explicit intent and exact paths. Validation should run before a
commit. Mastermind does not use broad automatic staging and does not push by
default. A user remains responsible for reviewing the resulting diff and any
remote operation.

## Durable goals

Goal Mode is bounded by declared scope, constraints, stop conditions, iteration
limits, and validation. It can pause on ambiguity, confirmation, stale state,
or failed checks. It must not broaden scope or claim completion without
evidence.

## What Mastermind does not protect against

No local tool can make an unsafe repository safe by itself. Review source
configuration, credentials, network exposure, tunnel configuration, generated
diffs, and third-party code. Keep sensitive sources out of a Custom GPT path
unless the disclosure and retention behavior is acceptable for that source.
