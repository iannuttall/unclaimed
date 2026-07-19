import type { CheckResult } from "@unclaimed/core";
import { checkDomain } from "@unclaimed/core";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import { useCallback, useRef, useState } from "react";
import { FLAT_TLD_PRICES, porkbunTldPrices } from "../pricing";
import type {
  AvailableBrowseOptions,
  AvailableSort,
  DomainRow,
  ResultUpdate,
  Store,
} from "../store";
import { FramedInput } from "./components/framed-input";
import { FullScreen } from "./components/full-screen";
import { Logo } from "./components/logo";
import { Panel } from "./components/panel";
import { Shortcuts } from "./components/shortcuts";
import { TextInput } from "./components/text-input";
import { nextThemeMode, type ThemeMode, ThemeProvider, useTheme } from "./theme";

const TAGLINE = "find available single-word domains.";
const PAGE_SIZE = 7;
const FORMS = [
  { label: "any", value: undefined },
  { label: "singular", value: "singular" },
  { label: "plural", value: "plural" },
] as const;
const LENGTHS = [
  { label: "any", min: undefined, max: undefined },
  { label: "5 or fewer", min: undefined, max: 5 },
  { label: "6 to 8", min: 6, max: 8 },
  { label: "9 or more", min: 9, max: undefined },
] as const;
const PREMIUM = [
  { label: "any", value: undefined },
  { label: "no premium", value: "no-premium" },
  { label: "premium only", value: "premium" },
] as const;
const PRICES = [
  { label: "any", value: undefined },
  { label: "$10 max", value: 10 },
  { label: "$20 max", value: 20 },
  { label: "$50 max", value: 50 },
  { label: "$100 max", value: 100 },
] as const;
const SORTS: Array<{ label: string; value: AvailableSort }> = [
  { label: "newest", value: "newest" },
  { label: "name", value: "name" },
  { label: "quality", value: "quality" },
  { label: "commercial", value: "commercial" },
  { label: "lowest price", value: "price" },
  { label: "shortest", value: "shortest" },
];
const FILTER_COUNT = 8;

type View = "check" | "browse";
type PricedCheckResult = CheckResult & {
  price: number | null;
  currency: string | null;
  premium: boolean | null;
  approximatePrice: boolean;
};
type Phase =
  | { name: "input"; warning?: string }
  | { name: "checking"; word: string; done: number; total: number }
  | { name: "results"; word: string; results: PricedCheckResult[] };

const Gap = ({ lines = 1 }: { lines?: number }) => (
  <Box flexDirection="column" flexShrink={0}>
    <Text>{Array.from({ length: lines }, () => " ").join("\n")}</Text>
  </Box>
);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function resultUpdate(result: CheckResult): ResultUpdate {
  return {
    status: result.status,
    source: result.source,
    expiry: result.expiry,
    estimatedAvailable: result.estimatedAvailable,
    siteStatus: null,
    hasSite: null,
    coldOutreach: false,
    httpStatus: null,
    checkedAt: result.checkedAt,
  };
}

function priceLabel(
  price: number | null,
  currency: string | null,
  premium: boolean | number | null,
  approximate = false,
) {
  if (price == null) return "";
  const amount = `${currency === "USD" ? "$" : ""}${price}`;
  return `${premium ? "*" : approximate ? "~" : ""}${amount}`;
}

function ResultRow({ result, selected }: { result: PricedCheckResult; selected: boolean }) {
  const theme = useTheme();
  const marker = result.status === "available" ? "✓" : result.status === "unknown" ? "?" : "·";
  const color =
    result.status === "available" ? "green" : result.status === "unknown" ? "yellow" : theme.gray;
  const price = priceLabel(result.price, result.currency, result.premium, result.approximatePrice);
  return (
    <Text bold={selected}>
      <Text color={selected ? theme.primary : theme.gray}>{selected ? "❯" : " "} </Text>
      <Text color={color}>{marker} </Text>
      <Text color={result.status === "available" ? "green" : theme.primary}>
        {result.domain.slice(0, 24).padEnd(24)}
      </Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>
        {result.status.padEnd(11)} {result.source.padEnd(6)}
      </Text>
      <Text color={result.premium ? "red" : theme.gray} dimColor={theme.dimSecondary}>
        {price.padStart(9)}
      </Text>
    </Text>
  );
}

function AvailableRow({ row, selected }: { row: DomainRow; selected: boolean }) {
  const theme = useTheme();
  const price = priceLabel(row.price, row.currency, row.premium);
  return (
    <Text bold={selected}>
      <Text color={selected ? theme.primary : theme.gray}>{selected ? "❯" : " "} </Text>
      <Text color="green">✓ {row.domain.slice(0, 29).padEnd(29)}</Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>
        {price.padStart(8)}
      </Text>
    </Text>
  );
}

function FilterRow({
  label,
  value,
  selected,
  editable = false,
}: {
  label: string;
  value: string;
  selected: boolean;
  editable?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text bold={selected}>
      <Text color={selected ? theme.primary : theme.gray}>{selected ? "❯" : " "} </Text>
      <Text color={theme.gray}>{label.padEnd(13)}</Text>
      <Text color={theme.primary}>
        {selected ? (editable ? `[ ${value} ]` : `‹ ${value} ›`) : value}
      </Text>
    </Text>
  );
}

function ViewTabs({ view }: { view: View }) {
  const theme = useTheme();
  return (
    <Text>
      <Text inverse={view === "check"} bold={view === "check"} color={theme.primary}>
        {" check a word "}
      </Text>
      <Text color={theme.gray}> </Text>
      <Text inverse={view === "browse"} bold={view === "browse"} color={theme.primary}>
        {" browse available "}
      </Text>
    </Text>
  );
}

export function App({
  tlds,
  browseTlds,
  store,
}: {
  tlds: string[];
  browseTlds: string[];
  store: Store;
}) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const initialView: View = store.countAvailable() > 0 ? "browse" : "check";
  return (
    <ThemeProvider mode={themeMode}>
      <AppContent
        tlds={tlds}
        browseTlds={browseTlds}
        store={store}
        initialView={initialView}
        cycleTheme={() => setThemeMode(nextThemeMode)}
      />
    </ThemeProvider>
  );
}

function AppContent({
  tlds,
  browseTlds,
  store,
  initialView,
  cycleTheme,
}: {
  tlds: string[];
  browseTlds: string[];
  store: Store;
  initialView: View;
  cycleTheme: () => void;
}) {
  const theme = useTheme();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState<View>(initialView);
  const [word, setWord] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "input" });
  const [selection, setSelection] = useState(0);
  const [browseFilter, setBrowseFilter] = useState(0);
  const [browsePage, setBrowsePage] = useState(0);
  const [browseSelection, setBrowseSelection] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchEditing, setSearchEditing] = useState(false);
  const [filterSelection, setFilterSelection] = useState(0);
  const [browseQuery, setBrowseQuery] = useState("");
  const [formFilter, setFormFilter] = useState(0);
  const [lengthFilter, setLengthFilter] = useState(0);
  const [premiumFilter, setPremiumFilter] = useState(0);
  const [priceFilter, setPriceFilter] = useState(0);
  const [sortFilter, setSortFilter] = useState(0);
  const [curatedFilter, setCuratedFilter] = useState(0);
  const runRef = useRef(0);
  const basePricesRef = useRef<Map<string, number> | null>(null);
  const columns = stdout?.columns && stdout.columns > 0 ? stdout.columns : 80;
  const inputWidth = Math.max(20, Math.min(54, columns - 14));
  const panelWidth = Math.max(42, Math.min(62, columns - 6));
  const browseTld = browseFilter === 0 ? undefined : browseTlds[browseFilter - 1];
  const browseOptions: AvailableBrowseOptions = { sort: SORTS[sortFilter].value };
  if (browseTld) browseOptions.tlds = [browseTld];
  if (browseQuery) browseOptions.term = browseQuery;
  if (FORMS[formFilter].value) browseOptions.form = FORMS[formFilter].value;
  if (LENGTHS[lengthFilter].min !== undefined) browseOptions.minLen = LENGTHS[lengthFilter].min;
  if (LENGTHS[lengthFilter].max !== undefined) browseOptions.maxLen = LENGTHS[lengthFilter].max;
  if (PREMIUM[premiumFilter].value) browseOptions.premium = PREMIUM[premiumFilter].value;
  if (PRICES[priceFilter].value !== undefined) browseOptions.maxPrice = PRICES[priceFilter].value;
  if (curatedFilter === 1) browseOptions.curated = true;
  const activeFilters = [
    browseFilter,
    browseQuery ? 1 : 0,
    formFilter,
    lengthFilter,
    premiumFilter,
    priceFilter,
    sortFilter,
    curatedFilter,
  ].filter((value) => value !== 0).length;
  const browseTotal = store.countAvailableBrowse(browseOptions);
  const maxBrowsePage = Math.max(0, Math.ceil(browseTotal / PAGE_SIZE) - 1);
  const safeBrowsePage = Math.min(browsePage, maxBrowsePage);
  const browseRows = store.availableBrowsePage(
    browseOptions,
    PAGE_SIZE,
    safeBrowsePage * PAGE_SIZE,
  );

  const reset = useCallback(() => {
    runRef.current++;
    setWord("");
    setSelection(0);
    setPhase({ name: "input" });
  }, []);

  const changeBrowseFilter = useCallback(
    (direction: number) => {
      const filters = browseTlds.length + 1;
      setBrowseFilter((current) => (current + direction + filters) % filters);
      setBrowsePage(0);
      setBrowseSelection(0);
    },
    [browseTlds.length],
  );

  const resetBrowsePosition = useCallback(() => {
    setBrowsePage(0);
    setBrowseSelection(0);
  }, []);

  const changeFilter = useCallback(
    (direction: number) => {
      const cycle = (current: number, length: number) => (current + direction + length) % length;
      resetBrowsePosition();
      switch (filterSelection) {
        case 0:
          changeBrowseFilter(direction);
          break;
        case 1:
          break;
        case 2:
          setFormFilter((current) => cycle(current, FORMS.length));
          break;
        case 3:
          setLengthFilter((current) => cycle(current, LENGTHS.length));
          break;
        case 4:
          setPremiumFilter((current) => cycle(current, PREMIUM.length));
          break;
        case 5:
          setPriceFilter((current) => cycle(current, PRICES.length));
          break;
        case 6:
          setSortFilter((current) => cycle(current, SORTS.length));
          break;
        case 7:
          setCuratedFilter((current) => cycle(current, 2));
          break;
      }
    },
    [changeBrowseFilter, filterSelection, resetBrowsePosition],
  );

  const clearFilters = useCallback(() => {
    setBrowseFilter(0);
    setBrowseQuery("");
    setFormFilter(0);
    setLengthFilter(0);
    setPremiumFilter(0);
    setPriceFilter(0);
    setSortFilter(0);
    setCuratedFilter(0);
    resetBrowsePosition();
  }, [resetBrowsePosition]);

  const checkWord = useCallback(
    (input: string) => {
      const normalized = input.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(normalized)) {
        setPhase({ name: "input", warning: "enter one word, without spaces or a tld" });
        return;
      }

      store.seed([normalized], tlds);
      const rows = new Map(store.forWord(normalized, tlds).map((row) => [row.domain, row]));
      const run = ++runRef.current;
      setWord(normalized);
      setPhase({ name: "checking", word: normalized, done: 0, total: tlds.length });
      void (async () => {
        let done = 0;
        const storedBasePrices = store.standardPrices(tlds);
        const needsRemotePrices = tlds.some(
          (tld) => FLAT_TLD_PRICES[tld] == null && !storedBasePrices.has(tld),
        );
        const basePricesPromise = !needsRemotePrices
          ? Promise.resolve(new Map<string, number>())
          : basePricesRef.current
            ? Promise.resolve(basePricesRef.current)
            : porkbunTldPrices()
                .then((prices) => {
                  if (prices.size) basePricesRef.current = prices;
                  return prices;
                })
                .catch(() => new Map<string, number>());
        const results = await mapLimit(tlds, 8, async (tld) => {
          const domain = `${normalized}.${tld}`;
          let result: CheckResult;
          try {
            result = await checkDomain(domain);
          } catch {
            result = {
              domain,
              tld,
              status: "unknown",
              source: "whois",
              expiry: null,
              estimatedAvailable: null,
              checkedAt: new Date().toISOString(),
            };
          }
          const row = rows.get(domain);
          if (row) store.applyResult(row, resultUpdate(result), true);
          done++;
          if (run === runRef.current) {
            setPhase({ name: "checking", word: normalized, done, total: tlds.length });
          }
          return { result, row };
        });
        if (run !== runRef.current) return;
        const basePrices = await basePricesPromise;
        if (run !== runRef.current) return;
        const pricedResults: PricedCheckResult[] = results.map(({ result, row }) => {
          const isAvailable = result.status === "available";
          const storedPrice = isAvailable ? (row?.price ?? null) : null;
          const basePrice =
            FLAT_TLD_PRICES[result.tld] ??
            storedBasePrices.get(result.tld) ??
            basePrices.get(result.tld) ??
            null;
          const useBasePrice = isAvailable && storedPrice == null;
          return {
            ...result,
            price: storedPrice ?? (useBasePrice ? basePrice : null),
            currency: isAvailable
              ? (row?.currency ?? (useBasePrice && basePrice != null ? "USD" : null))
              : null,
            premium: isAvailable && row?.premium != null ? Boolean(row.premium) : null,
            approximatePrice: useBasePrice && basePrice != null,
          };
        });
        const rank = { available: 0, unknown: 1, registered: 2 } as const;
        pricedResults.sort((left, right) => rank[left.status] - rank[right.status]);
        setSelection(0);
        setPhase({ name: "results", word: normalized, results: pricedResults });
      })();
    },
    [store, tlds],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") return exit();
    if (key.ctrl && input === "t") return cycleTheme();
    if (key.escape && searchEditing) return setSearchEditing(false);
    if (searchEditing) return;
    if (key.escape && phase.name !== "input") return reset();
    if (key.escape && filtersOpen) return setFiltersOpen(false);

    if (phase.name === "input") {
      if (key.tab) {
        setFiltersOpen(false);
        setView((current) => (current === "check" ? "browse" : "check"));
        setPhase({ name: "input" });
        return;
      }
      if (view !== "browse") return;
      if (input === "f") {
        setFiltersOpen((current) => !current);
        return;
      }
      if (filtersOpen) {
        if (key.upArrow || input === "k") {
          return setFilterSelection((current) => Math.max(0, current - 1));
        }
        if (key.downArrow || input === "j") {
          return setFilterSelection((current) => Math.min(FILTER_COUNT - 1, current + 1));
        }
        if (key.leftArrow) return changeFilter(-1);
        if (key.return && filterSelection === 1) return setSearchEditing(true);
        if (key.rightArrow || key.return) return changeFilter(1);
        if (input === "x") return clearFilters();
        return;
      }
      if (key.leftArrow) return changeBrowseFilter(-1);
      if (key.rightArrow) return changeBrowseFilter(1);
      if (key.upArrow || input === "k") {
        if (browseSelection > 0) return setBrowseSelection((current) => current - 1);
        if (safeBrowsePage > 0) {
          setBrowsePage((current) => current - 1);
          setBrowseSelection(PAGE_SIZE - 1);
        }
        return;
      }
      if (key.downArrow || input === "j") {
        if (browseSelection < browseRows.length - 1) {
          return setBrowseSelection((current) => current + 1);
        }
        if (safeBrowsePage < maxBrowsePage) {
          setBrowsePage((current) => current + 1);
          setBrowseSelection(0);
        }
        return;
      }
      if (input === "n" && safeBrowsePage < maxBrowsePage) {
        setBrowsePage((current) => current + 1);
        setBrowseSelection(0);
        return;
      }
      if (input === "p" && safeBrowsePage > 0) {
        setBrowsePage((current) => current - 1);
        setBrowseSelection(0);
        return;
      }
      if (key.return && browseRows[browseSelection]) {
        return checkWord(browseRows[browseSelection].word);
      }
      return;
    }

    if (phase.name !== "results") return;
    if (key.return) return reset();
    if (key.upArrow || input === "k") {
      setSelection((current) => Math.max(0, current - 1));
    }
    if (key.downArrow || input === "j") {
      setSelection((current) => Math.min(phase.results.length - 1, current + 1));
    }
  });

  const hints: Array<[string, string]> =
    phase.name === "input" && searchEditing
      ? [
          ["↵", "apply"],
          ["esc", "cancel"],
          ["^c", "quit"],
        ]
      : phase.name === "input" && view === "check"
        ? [
            ["tab", "browse"],
            ["↵", "check"],
            ["^c", "quit"],
            ["^t", `theme:${theme.mode}`],
          ]
        : phase.name === "input" && filtersOpen
          ? [
              ["↑↓", "field"],
              ["←→", "change"],
              ["↵", "edit"],
              ["x", "clear"],
              ["f/esc", "done"],
              ["^c", "quit"],
            ]
          : phase.name === "input"
            ? [
                ["tab", "check"],
                ["f", `filters${activeFilters ? `:${activeFilters}` : ""}`],
                ["↑↓", "names"],
                ["n/p", "page"],
                ["^c", "quit"],
              ]
            : phase.name === "checking"
              ? [
                  ["esc", "cancel"],
                  ["^c", "quit"],
                  ["^t", `theme:${theme.mode}`],
                ]
              : [
                  ["↑↓", "browse"],
                  ["↵", "another"],
                  ["esc", "back"],
                  ["^c", "quit"],
                  ["^t", `theme:${theme.mode}`],
                ];

  const available =
    phase.name === "results"
      ? phase.results.filter((result) => result.status === "available").length
      : 0;
  const pageStart = Math.floor(selection / PAGE_SIZE) * PAGE_SIZE;
  const visible =
    phase.name === "results" ? phase.results.slice(pageStart, pageStart + PAGE_SIZE) : [];

  return (
    <FullScreen>
      <Logo />
      <Gap />
      <Text color={theme.primary}>{TAGLINE}</Text>
      <Text color={theme.gray} dimColor={theme.dimSecondary}>
        rdap · whois · {tlds.length} tlds · {"11,822 words"}
      </Text>
      <Gap />

      {phase.name === "input" ? <ViewTabs view={view} /> : null}
      {phase.name === "input" ? <Gap /> : null}

      {phase.name === "input" && view === "check" ? (
        <Box flexDirection="column" alignItems="center">
          <FramedInput title="Enter one word" width={inputWidth} button="check">
            <TextInput
              value={word}
              onChange={setWord}
              onSubmit={checkWord}
              placeholder="orbit"
              width={inputWidth - 6}
            />
          </FramedInput>
          {phase.warning ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              ✗ {phase.warning}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {phase.name === "input" && view === "browse" && searchEditing ? (
        <FramedInput title="Search saved words" width={inputWidth} button="apply">
          <TextInput
            value={browseQuery}
            onChange={(value) => {
              setBrowseQuery(value);
              resetBrowsePosition();
            }}
            onSubmit={() => setSearchEditing(false)}
            placeholder="orbit"
            width={inputWidth - 6}
          />
        </FramedInput>
      ) : null}

      {phase.name === "input" && view === "browse" && filtersOpen && !searchEditing ? (
        <Panel title={`filters · ${activeFilters} active`} width={panelWidth} bodyHeight={8}>
          <FilterRow
            label="TLD"
            value={browseTld ? `.${browseTld}` : "all"}
            selected={filterSelection === 0}
          />
          <FilterRow
            label="Search"
            value={browseQuery || "any"}
            selected={filterSelection === 1}
            editable
          />
          <FilterRow
            label="Form"
            value={FORMS[formFilter].label}
            selected={filterSelection === 2}
          />
          <FilterRow
            label="Length"
            value={LENGTHS[lengthFilter].label}
            selected={filterSelection === 3}
          />
          <FilterRow
            label="Premium"
            value={PREMIUM[premiumFilter].label}
            selected={filterSelection === 4}
          />
          <FilterRow
            label="Price"
            value={PRICES[priceFilter].label}
            selected={filterSelection === 5}
          />
          <FilterRow
            label="Sort"
            value={SORTS[sortFilter].label}
            selected={filterSelection === 6}
          />
          <FilterRow
            label="Words"
            value={curatedFilter === 1 ? "curated only" : "all"}
            selected={filterSelection === 7}
          />
        </Panel>
      ) : null}

      {phase.name === "input" && view === "browse" && !filtersOpen ? (
        <Panel
          title={`available · ${browseTld ? `.${browseTld}` : "all tlds"} · ${browseTotal}${activeFilters ? ` · f:${activeFilters}` : ""}`}
          width={panelWidth}
          bodyHeight={8}
        >
          {browseRows.length ? (
            browseRows.map((row, index) => (
              <AvailableRow key={row.domain} row={row} selected={index === browseSelection} />
            ))
          ) : (
            <>
              <Text color={theme.gray}>No saved available domains for this filter.</Text>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                Tab to check your first word, or run unclaimed sweep.
              </Text>
            </>
          )}
          {browseTotal > PAGE_SIZE ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {safeBrowsePage * PAGE_SIZE + 1}-
              {Math.min((safeBrowsePage + 1) * PAGE_SIZE, browseTotal)} of {browseTotal} · page{" "}
              {safeBrowsePage + 1}/{maxBrowsePage + 1}
            </Text>
          ) : null}
        </Panel>
      ) : null}

      {phase.name === "checking" ? (
        <FramedInput title="Checking every TLD" width={inputWidth} button="check" buttonDim>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {phase.word}
          </Text>
        </FramedInput>
      ) : null}

      {phase.name === "results" ? (
        <Panel title={`${phase.word} · ${available} available`} width={panelWidth} bodyHeight={8}>
          {visible.map((result, index) => (
            <ResultRow
              key={result.domain}
              result={result}
              selected={pageStart + index === selection}
            />
          ))}
          {phase.results.length > PAGE_SIZE ? (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, phase.results.length)} of{" "}
              {phase.results.length}
            </Text>
          ) : null}
        </Panel>
      ) : null}

      <Gap lines={2} />
      <Shortcuts
        items={hints}
        leading={
          phase.name === "checking" ? (
            <Text>
              <Text color={theme.primary}>
                <Spinner type="dots" />
              </Text>
              <Text color={theme.gray} dimColor={theme.dimSecondary}>
                {" "}
                checking {phase.done}/{phase.total}
              </Text>
            </Text>
          ) : undefined
        }
      />
    </FullScreen>
  );
}
