# Security

Do not open a public issue for a suspected vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/iannuttall/unclaimed/security/advisories/new).
Remove API keys, account names, client IPs, local paths, database contents, and
registrar responses from every report.

## Credential boundaries

- Registrar credentials are read from the local environment.
- The SQLite catalogue stays on the local machine unless the user moves it.
- RDAP and WHOIS checks go directly to registry services.
- Liveness checks contact the domain being checked.
- Unclaimed does not collect telemetry or run a hosted service.

An `available` result is evidence from a registry lookup, not a purchase
guarantee. A timeout, rate limit, or unrecognised response must remain
`unknown`.

## Maintainer checks

Run these before publishing a release or changing registry classification,
credential handling, package contents, or browser launching:

```sh
pnpm check
pnpm test:package-install
pnpm security:check
pnpm pack:dry-run
```

The security check audits dependencies and scans the complete Git history for
committed secrets. Local ignored `.env` files are outside the public repository
and are not scanned.
