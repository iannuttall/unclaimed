<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/iannuttall/unclaimed/main/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/iannuttall/unclaimed/main/assets/logo-light.svg" alt="Unclaimed" width="456">
</picture>

**Find available single-word domains without living in registrar search boxes.**

Check one word or scan 11,822 bundled names across any delegated TLD. Unclaimed uses RDAP and WHOIS, saves every result locally, and lets long searches pick up where they stopped.

[Get started](#quick-start) ·
[Full documentation](https://github.com/iannuttall/unclaimed#readme) ·
[Project page](https://ian.is/unclaimed) ·
[Questions](https://github.com/iannuttall/unclaimed/issues) ·
[Security](https://github.com/iannuttall/unclaimed/blob/main/SECURITY.md) ·
[License](https://github.com/iannuttall/unclaimed/blob/main/LICENSE)

<a href="https://github.com/iannuttall/unclaimed/actions/workflows/ci.yml"><img alt="Checks" src="https://img.shields.io/github/actions/workflow/status/iannuttall/unclaimed/ci.yml?branch=main&label=checks&style=flat-square"></a>
<a href="https://www.npmjs.com/package/unclaimed"><img alt="npm version" src="https://img.shields.io/npm/v/unclaimed?style=flat-square"></a>
<a href="https://www.npmjs.com/package/unclaimed"><img alt="npm downloads" src="https://img.shields.io/npm/dm/unclaimed?style=flat-square"></a>
<img alt="Node 24 or newer" src="https://img.shields.io/badge/Node-24%2B-339933?style=flat-square">
<img alt="TypeScript ready" src="https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square">
<a href="https://github.com/iannuttall/unclaimed/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square"></a>

</div>

---

Unclaimed checks domain registries directly and keeps the answers in a local SQLite catalogue. Use it for one focused lookup, a resumable word-list scan, or an interactive terminal view of the names worth keeping.

Timeouts and unclear replies stay `unknown`. They are never quietly reported as available.

## Quick start

Requires Node.js 24 or newer.

```sh
npm i -g unclaimed
unclaimed check orbit --tlds io,ai,dev
```

Run `unclaimed` without a command to open the interactive interface. Tab moves between checking a word, browsing saved names, and updating the local catalogue.

You can also try one check without installing anything:

```sh
npx unclaimed check orbit.dev
```

## Search more than one word

The bundled catalogue contains 11,822 common and brandable English words. `sweep` checks new and unresolved rows, saves each result as it arrives, and resumes safely after a stop.

`.bot` has RDAP but no WHOIS service. Use Namecheap bulk checks so free names
can be confirmed instead of left as `unknown`:

```sh
unclaimed sweep --tlds bot --fast
unclaimed available --tlds bot --max-len 8 --sort commercial --limit 500
```

```sh
unclaimed sweep --tlds io,ai,dev
unclaimed available --sort commercial --limit 50
unclaimed available --singular --max-len 8 --no-premium
```

Bring your own newline-separated or JSON word list when the bundled corpus is not the right fit:

```sh
unclaimed sweep --words-file ./words.txt --tlds design,tools
```

## Use any delegated TLD

Pass any suffix directly or load a longer list from a file:

```sh
unclaimed check orbit --tlds co.uk,design,tools
unclaimed sweep --tlds-file ./tlds.txt
```

Unclaimed discovers normal WHOIS routes through IANA. The local config supports explicit RDAP, WHOIS, availability-pattern, and pacing overrides for unusual registries.

## Understand the answer

| Result | Meaning |
| --- | --- |
| `available` | The registry indicates that the domain is not registered. |
| `registered` | The registry returned a record or a reserved-name signal. |
| `unknown` | The lookup failed, timed out, was rate-limited, or could not be classified. |

Confirm an available result at a registrar before buying. Reservations, premium prices, and fresh registrations can change the final answer.

An automatic check confirms an RDAP not-found response through WHOIS. If the registry has no WHOIS service, the result stays `unknown`.

## Install the agent skill

```sh
npx skills add iannuttall/unclaimed
```

The packaged skill teaches agents to use explicit commands, preserve uncertainty, and avoid running an expensive full refresh unless you requested one.

## Keep going

The [full Unclaimed documentation](https://github.com/iannuttall/unclaimed#readme) covers the interactive browser, filters, registrar pricing, storage paths, every command, and local development.

Unclaimed is available under the [MIT License](https://github.com/iannuttall/unclaimed/blob/main/LICENSE). The interactive interface is adapted from [Yoinks](https://github.com/pablostanley/yoinks).
