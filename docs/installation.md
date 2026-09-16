# Install Mastermind

Mastermind is source-distributed. This guide covers the supported local
dashboard/CLI path, the native macOS path, and Custom GPT setup.

## Prerequisites

- Node.js and pnpm compatible with the repository toolchain.
- Git for source management and commits.
- A local repository, folder, or knowledge source you want to connect.
- macOS for the native application.

## Source checkout

```bash
git clone https://github.com/prochattools/mastermind.git
cd mastermind
pnpm install
pnpm --dir packages/cli build
pnpm --dir packages/cli type-check
```

The CLI package exposes `mastermind`. `workbench` and `buildflow` remain
compatibility aliases for existing installations.

## Local runtime

Start and verify the local dashboard/runtime from the repository root:

```bash
pnpm local:start
pnpm local:verify
```

The runtime stores source configuration and operational state locally. Use the
CLI or dashboard to register a source, then let indexing complete before
using it for context-heavy work. A stale index is a navigation aid, not proof
that a file is current.

## Native macOS path

The native application is the fast local path on macOS. Build and install it
through the controlled lifecycle:

```bash
pnpm macos:build
pnpm macos:prepare-owner-local
pnpm macos:install
pnpm macos:status
pnpm macos:doctor
```

The local ingress is `http://127.0.0.1:3154`. `macos:status` checks the
installed app, owner-local helper, portable host, and ingress. Run
`macos:doctor` when one of those components is unavailable.

The native install command consumes the generated owner-local release
manifest. It is intended for a local macOS owner and may require normal macOS
authorization for the app and helper lifecycle.

## Custom GPT setup

1. Start the local runtime or use an HTTPS endpoint you control.
2. Open `/api/openapi` or the checked-in `docs/openapi.chatgpt.json` schema.
3. Import the schema into the Custom GPT Action editor.
4. Configure bearer authentication with the owner-configured Action Token.
5. Use the instructions in `docs/CUSTOM_GPT_INSTRUCTIONS.md`.
6. Test status, one exact read, a write dry run, and then an approved write.

Use this canonical endpoint for the current public deployment:

```text
https://mastermind.prochat.tools
```

`https://workbench.prochat.tools` is retained only for existing compatibility
configurations. ChatGPT must be able to reach the configured server over HTTPS;
localhost is for local inspection and local clients.

## First safe operation

Start with `getMastermindStatus` using `include=sources` when the source is
unknown. Select one exact enabled `sourceId`, then call
`readMastermindContext` with a bounded mode. Use `dryRun` before an unfamiliar
write and commit only the exact paths the user approved.
