<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" alt="Unclaimed" width="456">
</picture>

**Find available single-word domains without living in registrar search boxes.**

Check one word or scan 11,822 bundled names across any delegated TLD. Unclaimed uses RDAP and WHOIS, saves every result locally, and lets long searches pick up where they stopped.

[Get started](#quick-start) ·
[npm](https://www.npmjs.com/package/unclaimed) ·
[Project page](https://ian.is/unclaimed) ·
[Questions](https://github.com/iannuttall/unclaimed/issues) ·
[Security](SECURITY.md) ·
[License](LICENSE) ·
[Agent notes](AGENTS.md)

<a href="https://github.com/iannuttall/unclaimed/actions/workflows/ci.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/iannuttall/unclaimed/ci.yml?branch=main&label=checks&style=flat-square"></a>
<a href="https://www.npmjs.com/package/unclaimed"><img alt="npm version" src="https://img.shields.io/npm/v/unclaimed?style=flat-square"></a>
<a href="https://www.npmjs.com/package/unclaimed"><img alt="npm downloads" src="https://img.shields.io/npm/dm/unclaimed?style=flat-square"></a>
<img alt="Node 24 or newer" src="https://img.shields.io/badge/Node-24%2B-339933?style=flat-square">
<img alt="TypeScript ready" src="https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square"></a>

</div>

---

Domain searches get annoying as soon as you care about more than one TLD. Unclaimed checks the registries directly, keeps the answers in SQLite, and gives you one catalogue to filter instead of another pile of open tabs.

It works as a focused command, a resumable scanner, or an interactive terminal app. Timeouts and unclear registry replies stay `unknown`; they are never quietly reported as available.

## Quick start

Unclaimed needs Node.js 24 or newer.

```sh
npm i -g unclaimed
unclaimed check orbit --tlds io,ai,dev
```

Run the bare command when you want the interactive interface:

```sh
unclaimed
```

Type one word to check it across your configured TLDs. Press Tab to move between checking a word, browsing saved names, and updating the local catalogue.

You can also try one check without installing anything:

```sh
npx unclaimed check orbit.dev
```

## What Unclaimed gives you

- One word checked across a handful of TLDs or every suffix you provide.
- A bundled list of 11,822 common and brandable English words.
- Resumable scans that save each answer as it arrives.
- Search and filters for TLD, length, singular form, premium status, price, and word quality.
- Exact registrar prices when configured, with normal TLD prices as a fallback.
- Headless commands and structured output for scripts, CI, and agents.
- A local SQLite catalogue with no account and no hosted service.

## Check one word across several TLDs

Pass a comma-separated list when the word matters more than the extension:

```sh
unclaimed check orbit --tlds io,ai,dev,app
```

Pass a complete domain when you only care about one result:

```sh
unclaimed check orbit.dev
```

Every result has one of three states:

| Result | Meaning |
| --- | --- |
| `available` | The registry indicates that the domain is not registered. |
| `registered` | The registry returned a record or a reserved-name signal. |
| `unknown` | The lookup failed, timed out, was rate-limited, or could not be classified. |

An available result is a strong lead, not a purchase guarantee. Registrars can reserve a name, apply premium pricing, or receive another registration first. Confirm the domain before buying it.

An RDAP not-found response needs WHOIS confirmation during an automatic check. If the registry has no WHOIS service, the result stays `unknown` instead of becoming a false `available` result.

## Search the bundled word list

`sweep` adds the bundled words to the local catalogue and checks rows that are new or unresolved. Stop it whenever you need to. The next run skips confident saved answers and carries on.

```sh
unclaimed sweep --tlds io,ai,dev
unclaimed available --sort commercial --limit 50
unclaimed stats
```

The useful names are usually hiding in a much larger result set. Filter before you browse:

```sh
unclaimed available --tlds dev,app --singular --max-len 8
unclaimed available --no-premium --max-price 20 --sort quality
unclaimed search orbit --status available
unclaimed candidates --limit 50
unclaimed dropping --limit 50
```

Bring your own JSON array or newline-separated word list with `--words-file`:

```sh
unclaimed sweep --words-file ./words.txt --tlds design,tools
```

## Refresh saved answers

`sweep` leaves confident old answers alone. `refresh` deliberately asks again.

```sh
# Recheck the bundled corpus on the default TLDs
unclaimed refresh

# Recheck every saved row, including imported words and custom TLDs
unclaimed refresh --all
```

A full refresh can make hundreds of thousands of registry requests. Narrow the scope when you do not need everything:

```sh
unclaimed refresh --tlds io,ai --concurrency 12
```

Liveness checks are disabled during refresh because fetching every registered site is much slower. Add `--liveness` when parked-site or cold-outreach data matters.

## Use any delegated TLD

Most TLDs work without a code change. Unclaimed asks IANA for the authoritative WHOIS server and caches the answer.

```sh
unclaimed check orbit --tlds co.uk,design,tools
unclaimed sweep --tlds-file ./tlds.txt
```

`--tlds-file` accepts a JSON array or comma, space, or newline-separated text. Registry overrides can be saved in the config shown by `unclaimed config`.

```json
{
  "tlds": ["io", "ai", "co.uk"],
  "whois": {
    "example": "whois.registry.example"
  },
  "rdap": {
    "example": "https://rdap.registry.example/domain/{domain}"
  },
  "availablePatterns": {
    "example": ["domain is free"]
  },
  "whoisPaceMs": {
    "whois.registry.example": 1500
  }
}
```

Only add a custom availability pattern after inspecting real registry output. A loose match can turn a registered domain into a false positive.

## Add live registrar data

Normal checks do not need a registrar account. Unclaimed can add exact pricing and premium status through optional registrar credentials.

Namecheap can check up to 50 domains in one request. Add its credentials to `.env`:

```dotenv
NAMECHEAP_API_USER=your-user
NAMECHEAP_API_KEY=your-key
NAMECHEAP_USERNAME=your-user
# Optional when automatic IP detection is unsuitable
NAMECHEAP_CLIENT_IP=203.0.113.10
```

Then run the faster registrar-backed refresh:

```sh
unclaimed refresh --all --fast
```

Your client IP must be allowed in Namecheap. TLDs that Namecheap does not sell fall back to RDAP or WHOIS.

Press `b` on an available result in the interactive interface to open it at a registrar. Porkbun is used when its pricing feed covers the TLD. Netim handles `.md`, `.so`, and the fallback route.

## Your catalogue stays on your machine

The SQLite database lives in your normal local data directory:

| Environment | Default path |
| --- | --- |
| macOS and Linux | `~/.local/share/unclaimed/domains.db` |
| XDG configured | `$XDG_DATA_HOME/unclaimed/domains.db` |
| Explicit override | `$UNCLAIMED_DB`, config `database`, or `--db <path>` |

Unclaimed has no account or hosted API. Checks go directly to registry RDAP and WHOIS services, registrar APIs you configure, and domains themselves when liveness checks are enabled.

## Give your agent the focused workflow

The repository includes a skill that teaches agents to use explicit commands, keep `unknown` separate from `available`, and avoid starting a huge refresh unless you asked for one.

```sh
npx skills add iannuttall/unclaimed
```

The Skills CLI discovers the `unclaimed` skill directly from the repository. There are no manual copies or symlinks to maintain.

## Command reference

| Command | What it does |
| --- | --- |
| `check <word\|domain>` | Check one word across TLDs or one complete domain. |
| `sweep` | Seed words and check new or unresolved rows. |
| `refresh` | Recheck saved rows in the selected scope. |
| `verify` | Recheck rows with one stored status. |
| `price` | Add registrar pricing to available rows. |
| `available` | List domains marked available. |
| `candidates` | List registered domains with no live site. |
| `dropping` | List registered domains by estimated drop date. |
| `search <term>` | Search stored words. |
| `stats` | Show database coverage and status counts. |
| `config` | Show active config and database paths. |

Run `unclaimed --help` for flags and examples.

## Develop locally

Unclaimed is a pnpm and Turborepo workspace:

```text
packages/core       registry resolution and bundled words
packages/cli        npm package, CLI, SQLite store, pricing, and skill
packages/cli/src/ui interactive Ink interface
scripts             word-corpus and repository checks
research            source research kept out of runtime code
```

```sh
corepack enable
pnpm install
pnpm unclaimed check orbit --tlds io,ai,dev
pnpm check
pnpm test:package-install
pnpm security:check
pnpm pack:dry-run
```

The repository command uses `./data/domains.db`. The published package uses the per-user data path described above.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change. [AGENTS.md](AGENTS.md) records the product rules and common traps for coding agents.

## License

Unclaimed is available under the [MIT License](LICENSE). The interactive interface is adapted from [Yoinks](https://github.com/pablostanley/yoinks); details are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
