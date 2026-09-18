# Mastermind Local documentation

This directory is the public product guide for the self-hosted Mastermind
Local snapshot. The current beta is `2.0.0-beta`.

## Start here

1. [`../../README.md`](../../README.md) — product overview and quick start.
2. [`../../installation.md`](../../installation.md) — local, macOS, and
   Custom GPT installation.
3. [`../../architecture.md`](../../architecture.md) — runtime and action
   boundaries.
4. [`../../safety.md`](../../safety.md) — authority, writes, commands, and
   Git safety.
5. [`../../troubleshooting.md`](../../troubleshooting.md) — bounded recovery
   paths.
6. [`../../openapi.chatgpt/README.md`](../../openapi.chatgpt/README.md) —
   Custom GPT schema import.
7. [`../../CUSTOM_GPT_INSTRUCTIONS.md`](../../CUSTOM_GPT_INSTRUCTIONS.md) —
   canonical GPT behavior.

## Public boundary

Mastermind Local contains the local runtime, menu-bar-first native macOS
companion, advanced dashboard/CLI surfaces, public action schema, and
contribution documentation needed for user-owned workflows. ChatGPT is the
normal conversation and work-initiation surface; discovery and indexing are
automatic in the native path. Private operational material, internal release
controls, and non-public product planning are intentionally not exported.

The public source is licensed under `AGPL-3.0-only`. See the repository root
for licensing, security, and contribution information.
