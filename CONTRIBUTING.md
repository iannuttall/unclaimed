# Contributing

Use [GitHub Issues](https://github.com/iannuttall/unclaimed/issues) for bugs and
focused proposals. Keep one problem per issue. Remove API keys, registrar
responses, local database contents, and domains you do not want made public.

Report suspected vulnerabilities through
[private vulnerability reporting](https://github.com/iannuttall/unclaimed/security/advisories/new),
not a public issue.

## Local checks

```sh
pnpm install
pnpm check
pnpm test:package-install
pnpm security:check
pnpm pack:dry-run
```

Use a temporary or explicit database for manual checks. Do not run a full
refresh against somebody's normal catalogue while testing a change.

```sh
pnpm unclaimed stats --db /tmp/unclaimed-test.db
```

Keep shared registry logic in `packages/core`. The command, SQLite store,
pricing adapters, interactive interface, and packaged skill belong in
`packages/cli`.

Contributions are licensed under the MIT license.
