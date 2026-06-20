# domain-check

Checks domain availability across **any** TLD using RDAP where it exists and
falling back to raw WHOIS (over TCP) where it doesn't — so new gTLDs (`.agent`)
and RDAP-less ccTLDs (`.md`) are all covered. For registered names it also reads
the **expiry date**, estimates when the name could **drop**, and probes whether a
real **site** exists (cold-outreach leads).

Runs two ways from one codebase:

- **Local CLI** (no deploy, no Cloudflare) — the quickest way to use it.
- **Cloudflare Worker** — if you want it as an always-on HTTP API + cron.

The only runtime difference is the WHOIS transport (`node:net` vs
`cloudflare:sockets`), injected at the entry point; everything else is shared.

## CLI (local, no deploy)

```bash
pnpm install
pnpm domains check prompt.io
pnpm domains check prompt --tlds=io,ai,dev,run,now   # one word across TLDs
pnpm domains sweep                                   # curated list × priority TLDs
pnpm domains available                               # what's free
pnpm domains candidates                              # registered but no real site
pnpm domains dropping                                # registered, soonest drop first
pnpm domains stats
```

`sweep` checks the curated word list (`src/words.json`) across a priority TLD set
and stores every result in a local SQLite db (`data/domains.db`, via Node's
built-in `node:sqlite`). It's resumable (re-run to continue / retry `unknown`s)
and the query commands read straight from that db. Flags: `--tlds=`, `--words=N`,
`--concurrency=`, `--retries=`, `--no-liveness`, `--limit=`.

## Why this approach

- **RDAP** is clean JSON but incomplete: only gTLDs in the IANA bootstrap, plus a
  few ccTLDs with direct endpoints. New gTLDs lag; most ccTLDs never join.
- **WHOIS** exists for every delegated TLD. Workers can reach it over TCP port 43
  via the `connect()` socket API, so it works as the universal fallback at $0.
- Status is only ever reported `available` from an authoritative `not found`.
  Anything ambiguous (429, 5xx, unknown server) returns `unknown` — never a
  false "available".

## Resolution order (per domain)

1. Direct registry RDAP for known ccTLDs (`io`, `so`, …) — `resolvers.ts → RDAP_OVERRIDES`
2. `rdap.org`, but only if the TLD is in the IANA bootstrap (otherwise its 404 lies)
3. WHOIS over TCP — `whois.nic.<tld>` by default, with overrides for odd registries

A RDAP `unknown` (rate-limited / down) automatically falls through to WHOIS.

## Run / deploy

```bash
pnpm install
pnpm dev           # local: http://localhost:8787
pnpm deploy        # ship to Cloudflare
```

## Usage

```
# single domain
/?domain=prompt.md

# one word across many TLDs
/?name=prompt&tlds=md,io,so,agent,dev,app,ai,xyz
```

Response:

```json
[
  {
    "domain": "prompt.md",
    "tld": "md",
    "status": "registered",
    "source": "whois",
    "expiry": "2027-05-17T00:00:00.000Z",
    "estimatedAvailable": "2027-08-05T00:00:00.000Z",
    "checkedAt": "2026-06-18T19:58:07.158Z"
  },
  {
    "domain": "prompt.agent",
    "tld": "agent",
    "status": "available",
    "source": "whois",
    "expiry": null,
    "estimatedAvailable": null,
    "checkedAt": "2026-06-18T19:58:07.158Z"
  }
]
```

- `status` is one of `available | registered | unknown`.
- `source` is `rdap | whois | cache`.
- `expiry` is the registry expiry date (ISO) when registered and exposed.
- `estimatedAvailable` is a best-effort "could be free by" date: `expiry + 80d`
  (auto-renew grace ≤45 + redemption 30 + pending-delete 5). It's "if abandoned",
  not "will be free" — most names get renewed. `null` unless registered with a
  known expiry.

### Stability: RDAP vs WHOIS

For a given domain the answer is deterministic, and RDAP and WHOIS agree when
both can answer. Pin a source to compare:

```
/?domain=google.com&source=rdap
/?domain=google.com&source=whois
```

`unknown` is only ever returned when a source genuinely can't answer (no RDAP for
the TLD, no WHOIS host, or a rate-limit/timeout) — never a false `available`.
Confirm agreement across a sample with:

```bash
pnpm dev
node scripts/compare-sources.mjs
```

## Optional caching

Bind a KV namespace to cache results (6h TTL) and the IANA bootstrap (weekly):

```bash
pnpm wrangler kv namespace create DOMAIN_CACHE
```

Then uncomment the `[[kv_namespaces]]` block in `wrangler.toml` and paste the id.
`unknown` results are never cached.

## Tracking premium brandable names

Beyond one-off checks, the Worker can track a curated list of **premium,
brandable single words** (singular + plural — `prompts`, `console`,
`opportunity`) across a set of TLDs, re-check them on a cron, and surface:

- `/available` — tracked names that are currently available
- `/candidates` — names that are **registered but have no real site** (dead DNS
  or a parking lander) — cold-outreach leads
- `/dropping` — registered names sorted by **soonest estimated drop**
  (`expiry + 80d`)
- `/stats` — coverage + counts

### The word list (two-stage audit)

`src/words.json` is built, not hand-typed, so it's reproducible and tunable:

1. **Heuristic pass** (`pnpm build:words`) — starts from a frequency-ranked
   English list (Norvig) and WordNet, keeps only **common nouns** (singular +
   plural), drops rare words, gerunds (`-ing`), past tense (`-ed`), adverbs,
   adjectives, proper nouns, bad/uncountable plurals. ~333k → ~10k.
2. **LLM brandability pass** — the survivors are judged against a strict
   premium-brandability rubric (`scripts/RUBRIC.md`, then a stricter
   `scripts/RUBRIC2.md`), cutting to the curated set in `src/words.json`.

Re-run stage 1 with `pnpm build:words`; the LLM passes are driven by the batch
files under `scripts/data/`. The funnel that produced the current list:

```
~333,000  all English words (frequency list)
   ~10,000  heuristic pass: common nouns, no -ing/-ed/adverbs/proper nouns
    ~3,750  LLM pass 1: brandable common nouns (RUBRIC.md)
    ~1,250  LLM pass 2: premium tier only (RUBRIC2.md)
   +~110    recovery pass: common words pass 2 over-cut (RUBRIC_RECOVERY.md)
    ~1,360  final -> src/words.json
```

`scripts/finalize-words.mjs` also has a small hand-edited `ALWAYS` allowlist for
obvious premium words the ruthless passes drop (e.g. `opportunity`).

Tune strictness via `FREQ_RANK_LIMIT` in `build-wordlist.mjs` (looser = more
candidates) and the rubrics. To widen the final list, merge pass 1 instead:
`node scripts/merge-curated.mjs keep`.

### Tracking setup (D1)

```bash
pnpm wrangler d1 create domains-tracker          # paste the id into wrangler.toml
pnpm wrangler d1 migrations apply domains-tracker --remote
pnpm deploy
```

Edit `TRACKED_TLDS` in `src/tracking.ts` to choose which TLDs to track (the
default is ~75 brandable / action new gTLDs: `run`, `now`, `app`, `dev`, `ai`,
`io`, `studio`, `build`, `store`, …). The resolver handles any delegated TLD, so
adding more just works.

After deploy, **seed once** (100k+ rows is too much for a single cron tick):

```
/seed            # populate word × TLD rows (idempotent), gated by ADMIN_TOKEN
/run?n=60        # re-check a batch now
```

Then the cron (`*/5 * * * *`) re-checks the stalest 60 rows each tick at low
concurrency (RDAP/WHOIS rate-limit per IP), recording expiry, drop estimates and
site presence.

**Cycle time:** rows = words × TLDs (≈1,360 × 75 ≈ 102k). At 60 rows / 5 min a
full re-check takes ~5 days. Go faster by raising the cron `limit` in
`scheduled()` (registered names also do a liveness fetch, so watch the Workers
subrequest limit — the paid plan allows 1,000/invocation) or by trimming TLDs.

Local dev uses a local SQLite copy:

```bash
pnpm wrangler d1 migrations apply domains-tracker --local
pnpm dev
curl 'http://localhost:8787/seed'
curl 'http://localhost:8787/run?n=20'
curl 'http://localhost:8787/dropping'
```

## Extending

- **New ccTLD with RDAP** → add to `RDAP_OVERRIDES` in `src/resolvers.ts`.
- **Registry whose WHOIS host isn't `whois.nic.<tld>`** → add to `WHOIS_OVERRIDES`.
- **Registry with an odd "not found" phrase** → add a TLD entry to `AVAILABLE_PATTERNS`.
- Discover the right WHOIS host for any TLD by querying `whois.iana.org`.

## Notes

- Registry RDAP/WHOIS both rate-limit per IP. The Worker caps concurrency at 8
  and (with KV) caches confident answers. Add backoff if you check large lists.
- WHOIS parsing is heuristic by nature; the pattern maps cover the common cases.
  When in doubt the Worker returns `unknown` rather than guessing.
