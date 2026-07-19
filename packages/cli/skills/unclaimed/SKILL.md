---
name: unclaimed
description: Use the Unclaimed CLI to find, refresh, filter, and price available single-word domains through RDAP, WHOIS, and optional registrar checks. Use when someone asks whether one word is available across TLDs, wants to scan the bundled word corpus, refresh stored availability, search results, add unsupported TLD routing, or inspect domain pricing.
---

# Unclaimed

Use `unclaimed` for single words only. Prefer a focused check before starting a large sweep.

Always use an explicit headless command in agent workflows. Do not launch bare `unclaimed`; that form is the interactive interface for humans in a TTY.

## Choose the command

- Check one word across TLDs: `unclaimed check orbit --tlds io,ai,dev`
- Check one full domain: `unclaimed check orbit.dev`
- Add and check new rows: `unclaimed sweep --tlds io,ai,dev`
- Recheck every bundled word on selected TLDs: `unclaimed refresh --tlds io,ai,dev`
- Recheck every stored row, including custom TLDs and imported words: `unclaimed refresh --all`
- List free names: `unclaimed available --sort commercial --limit 50`
- Search stored words: `unclaimed search orbit --status available`
- Inspect coverage: `unclaimed stats`

Use `--db <path>` to operate on a specific database. Run `unclaimed config` to show the active config and database paths.

## Refresh availability

`sweep` skips confident stored results. Use `refresh` when the user wants current data.

The complete update is:

```sh
unclaimed refresh --all
```

This can take a long time and makes live registry requests. Narrow it with `--tlds` when a complete refresh was not explicitly requested. Add `--liveness` only when parked or inactive sites matter.

For the quickest bulk pass, configure Namecheap credentials and use:

```sh
unclaimed refresh --all --fast
```

Fast mode uses registrar bulk checks for supported TLDs and falls back to RDAP or WHOIS for the rest. It needs `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, and `NAMECHEAP_USERNAME`; Namecheap must allow the current client IP.

## Add TLDs

For a one-off check, pass any delegated suffix:

```sh
unclaimed check orbit --tlds co.uk,design,tools
unclaimed sweep --tlds-file ./tlds.txt
```

Unclaimed discovers the authoritative WHOIS server through IANA when possible. Put repeat TLDs and unusual registry rules in the config path shown by `unclaimed config`:

```json
{
  "tlds": ["io", "ai", "co.uk"],
  "whois": { "example": "whois.registry.example" },
  "rdap": { "example": "https://rdap.registry.example/domain/{domain}" },
  "availablePatterns": { "example": ["domain is free"] },
  "whoisPaceMs": { "whois.registry.example": 1500 }
}
```

Only add an availability pattern after inspecting that registry's real response. A loose pattern can create false positives.

## Interpret results

- `available` means the registry response indicates no registration. Confirm at a registrar before buying.
- `registered` means the registry returned a record or reserved-name signal.
- `unknown` means the registry timed out, rate-limited, or returned an unrecognised response. Do not report it as available.
- Premium price data is registrar-specific and can change.

When presenting candidates, keep the exact single word visible, include its TLD, and separate confirmed availability from unknown results.
