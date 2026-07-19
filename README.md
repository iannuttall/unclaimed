# unclaimed

Find available single-word domains from your terminal.

Unclaimed checks RDAP first, falls back to WHOIS, and stores results in a local SQLite database. It ships with 11,822 common and brandable English words, accepts your own word lists, and can search any delegated TLD.

## Install

Unclaimed needs Node.js 24 or newer because it uses the built-in SQLite module.

```sh
npm install --global unclaimed
```

You can also run it without installing:

```sh
npx unclaimed check orbit --tlds io,ai,dev
```

## Interactive mode

Run the bare command in a terminal to open the interactive interface:

```sh
unclaimed
```

Type one word and Unclaimed checks it across your configured TLDs. Available results include saved exact prices when known or a `~$` standard TLD price as a fallback. Use the arrow keys to browse results, Enter to check another word, Escape to go back, and Ctrl-T to change the theme.

Press Tab to browse saved available names. Press `f` for search plus filters covering TLD, singular or plural form, word length, premium status, maximum price, curated words, and sorting by newest, name, quality, commercial value, price, or length. The view paginates the local database and shows saved pricing when present. Live checks from the interface are saved automatically.

The interface only starts when both input and output are attached to a terminal. Commands, flags, pipes, agents, and CI stay headless:

```sh
unclaimed check orbit --tlds io,ai,dev
unclaimed stats --tlds dev
unclaimed available --limit 20
```

## Check a word

The main input is one word. Pass a comma-separated set of TLDs to check it across several registries:

```sh
unclaimed check orbit --tlds io,ai,dev,app
```

Or check one complete domain:

```sh
unclaimed check orbit.dev
```

Results are one of:

- `available`: the registry indicates that the domain is not registered
- `registered`: the registry returned a record or reserved-name signal
- `unknown`: the lookup timed out, was rate-limited, or could not be classified

Treat availability as a strong lead, not a purchase guarantee. Registrars can still reserve a name or charge a premium price.

## Scan the word list

`sweep` seeds the bundled corpus and checks rows that are new or unresolved. Confident old results are skipped, so you can stop and resume it safely.

```sh
unclaimed sweep --tlds io,ai,dev
unclaimed available --sort commercial --limit 50
unclaimed stats
```

Useful filters:

```sh
unclaimed available --tlds dev,app --singular --max-len 8
unclaimed available --no-premium --max-price 20 --sort quality
unclaimed search orbit --status available
unclaimed candidates --limit 50
unclaimed dropping --limit 50
```

Pass your own JSON array or newline-separated word list with `--words-file`:

```sh
unclaimed sweep --words-file ./words.txt --tlds design,tools
```

## Refresh everything

`sweep` does not recheck confident results. `refresh` does.

Recheck the bundled corpus on the default TLDs:

```sh
unclaimed refresh
```

Recheck every row already in the database, including custom TLDs and imported words:

```sh
unclaimed refresh --all
```

This is the full update command. It can make hundreds of thousands of live registry requests, so expect it to take time. Narrow it when needed:

```sh
unclaimed refresh --tlds io,ai --concurrency 12
```

Liveness checks are off during refresh because fetching every registered website is much slower. Add `--liveness` when you need parked-site or cold-outreach data.

### Fast registrar refresh

Namecheap can check up to 50 domains per request. Add these values to `.env`:

```dotenv
NAMECHEAP_API_USER=your-user
NAMECHEAP_API_KEY=your-key
NAMECHEAP_USERNAME=your-user
# Optional when automatic IP detection is unsuitable
NAMECHEAP_CLIENT_IP=203.0.113.10
```

Then run:

```sh
unclaimed refresh --all --fast
```

Your current client IP must be allowed in Namecheap. TLDs that Namecheap does not sell fall back to RDAP or WHOIS. Fast results also include registrar availability and premium pricing when returned.

## Add any TLD

You do not need a code change for most TLDs:

```sh
unclaimed check orbit --tlds co.uk,design,tools
unclaimed sweep --tlds-file ./tlds.txt
```

`--tlds-file` accepts a JSON array or comma, space, or newline-separated text.

Unclaimed loads repeat settings from the JSON config shown by `unclaimed config`. The default location is `~/.config/unclaimed/config.json`, or `$XDG_CONFIG_HOME/unclaimed/config.json` when set.

```json
{
  "tlds": ["io", "ai", "co.uk"],
  "database": "/absolute/path/to/domains.db",
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

For unknown TLDs, Unclaimed asks IANA for the authoritative WHOIS server and caches the answer. Use config overrides for registries with unusual endpoints, response wording, or rate limits. Only add an availability pattern after inspecting real registry output, since a loose match can create false positives.

## Data and privacy

The default database is:

- macOS and Linux: `~/.local/share/unclaimed/domains.db`
- with XDG configured: `$XDG_DATA_HOME/unclaimed/domains.db`
- override: `$UNCLAIMED_DB`, config `database`, or `--db <path>`

The database stays on your machine. Checks go directly to registry RDAP and WHOIS services, registrar APIs you configure, and domains themselves when liveness checks are enabled.

If you used the old repository-local database, keep using it with:

```sh
unclaimed stats --db ./data/domains.db
unclaimed refresh --all --db ./data/domains.db
```

## Commands

| Command | What it does |
| --- | --- |
| `check <word\|domain>` | Check one word across TLDs or one complete domain |
| `sweep` | Seed words and check new or unresolved rows |
| `refresh` | Recheck all rows in the selected scope |
| `verify` | Recheck rows with one stored status |
| `price` | Add registrar pricing to available rows |
| `available` | List domains marked available |
| `candidates` | List registered domains with no live site |
| `dropping` | List registered domains by estimated drop date |
| `search <term>` | Search stored words |
| `stats` | Show database coverage and status counts |
| `config` | Show active config and database paths |

Run `unclaimed --help` for the compact command reference.

## Agent skill

The npm package includes an agent skill at `skills/unclaimed/SKILL.md`. It teaches agents to choose a focused check, run a full refresh when requested, extend TLD routing, and avoid reporting `unknown` as available.

To use it from this repository, add or symlink [`packages/cli/skills/unclaimed`](packages/cli/skills/unclaimed) to your agent's skills directory.

## Development

This is a pnpm and Turborepo workspace:

```text
packages/core     registry resolution and bundled words
packages/cli      npm package, CLI, SQLite store, pricing, and skill
apps/worker       optional Cloudflare Worker API kept separate from npm
scripts           reproducible word-corpus tooling
research          kept research artifacts
```

```sh
corepack enable
pnpm install
pnpm unclaimed check orbit --tlds io,ai,dev
pnpm check
pnpm pack:dry-run
```

The repository command uses `./data/domains.db` so `pnpm unclaimed` opens the existing development catalogue. The published package uses the per-user data path described above.

The optional Worker is not required by the CLI or npm package. Its D1 binding must be configured before deployment.

## Publishing

The package is published from `packages/cli` through the release workflow. Before the first release:

1. Create `iannuttall/unclaimed` on GitHub and push this repository.
2. Configure `unclaimed` on npm to trust the GitHub Actions release workflow.
3. Update the package version and create a GitHub release.

The workflow builds, tests, packs, and publishes with npm provenance. No website or project domain is required.

## License

MIT. The interactive interface is adapted from [Yoinks](https://github.com/pablostanley/yoinks); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
