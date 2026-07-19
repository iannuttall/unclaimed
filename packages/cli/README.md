# unclaimed

Find available single-word domains from your terminal.

```sh
npm install --global unclaimed
unclaimed
```

The bare command opens the interactive interface in a terminal. Press Tab to switch between checking one word and browsing saved available names. The browse view has search, TLD, form, length, premium, price, corpus, and sort filters. Explicit commands and flags stay headless for agents, scripts, and CI:

```sh
unclaimed check orbit --tlds io,ai,dev
```

Unclaimed checks RDAP first, falls back to WHOIS, and stores results in local SQLite. It bundles 11,822 words and accepts your own word and TLD lists.

## Full update

```sh
# Recheck the bundled corpus on the default TLDs
unclaimed refresh

# Recheck every stored row, including custom imports
unclaimed refresh --all
```

For a faster registrar-backed pass, configure Namecheap credentials and run `unclaimed refresh --all --fast`.

## Custom TLDs

```sh
unclaimed check orbit --tlds co.uk,design,tools
unclaimed sweep --tlds-file ./tlds.txt
```

Run `unclaimed config` to find the config file. It supports default `tlds`, `database`, and per-TLD `rdap`, `whois`, `availablePatterns`, and `whoisPaceMs` overrides.

## Results

- `available`: the registry indicates no registration
- `registered`: a registration or reserved-name signal was found
- `unknown`: the response could not be classified, so do not treat it as free

Confirm an available result at a registrar before buying. Pricing and premium status can change.

## More

See the [full documentation](https://github.com/iannuttall/unclaimed#readme) for scanning, filters, pricing, storage, agent skill usage, and development.

MIT. The interactive interface is adapted from [Yoinks](https://github.com/pablostanley/yoinks); see `THIRD_PARTY_NOTICES.md` in the package.
