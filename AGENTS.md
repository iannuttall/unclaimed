# Agent guide

## What this repo is

Unclaimed is a Node.js CLI and npm package for checking single-word domain availability. It is intentionally GitHub and npm only. Do not add a marketing site unless the project owner asks for one.

## Rules

- Keep the product focused on single words. Do not turn it into a general naming generator.
- Treat `unknown` as unknown, never as available.
- Use explicit commands such as `unclaimed check` in agents and automation. Bare `unclaimed` is the human TTY interface.
- Preserve resumable SQLite behavior. `sweep` handles new or unresolved rows; `refresh` rechecks old results.
- Keep the published `unclaimed` package free of Worker-only dependencies.
- Keep Ink and React lazy-loaded so headless commands do not pay the interactive UI startup cost.
- Prefer platform APIs and zero-runtime-dependency code when practical.
- Update the README and bundled skill when command behavior changes.
- Do not commit local databases, credentials, generated build output, or registrar responses.

## Structure

```text
packages/core     RDAP, WHOIS classification, liveness, and bundled words
packages/cli      npm package, CLI, SQLite store, registrar pricing, and skill
packages/cli/src/ui  interactive Ink interface, loaded only for a bare TTY command
apps/worker       optional Cloudflare API, outside the npm package
scripts           word-corpus build and research tooling
research          useful source research kept out of runtime code
```

The CLI injects the Node WHOIS transport into `@unclaimed/core`. The Worker injects its Cloudflare sockets transport. Keep the core runtime-independent.

## Commands

```sh
pnpm install
pnpm unclaimed --help
pnpm unclaimed check orbit --tlds io,ai,dev
pnpm check
pnpm pack:dry-run
```

Use a temporary or explicit database for tests and experiments:

```sh
pnpm unclaimed stats --db /tmp/unclaimed-test.db
```

Do not run `refresh --all` casually. It can issue hundreds of thousands of live registry requests. When it is explicitly requested, the exact command is `unclaimed refresh --all`.

## Before publishing

- Run `pnpm check`.
- Inspect `pnpm pack:dry-run` and keep the tarball limited to the built package, README, license, and skill.
- Check `unclaimed --version` matches `packages/cli/package.json`.
- Confirm npm trusted publishing points at `.github/workflows/publish.yml`.
