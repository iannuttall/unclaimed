import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openStore } from "../src/open-store";

const available = {
  status: "available" as const,
  source: "rdap",
  expiry: null,
  estimatedAvailable: null,
  siteStatus: null,
  hasSite: null,
  coldOutreach: false,
  httpStatus: null,
  checkedAt: new Date().toISOString(),
};

test("filters and paginates available domains in SQLite", async () => {
  const root = mkdtempSync(join(tmpdir(), "unclaimed-store-"));
  const store = await openStore(join(root, "domains.db"));
  store.seed(["orbit", "orbits", "galaxy"], ["dev"]);

  for (const word of ["orbit", "orbits", "galaxy"]) {
    const row = store.forWord(word, ["dev"])[0];
    store.applyResult(row, available);
  }

  const orbit = store.forWord("orbit", ["dev"])[0];
  const orbits = store.forWord("orbits", ["dev"])[0];
  store.applyPricing(orbit, {
    available: true,
    premium: false,
    price: 12,
    renewalPrice: 12,
    currency: "USD",
  });
  store.applyPricing(orbits, {
    available: true,
    premium: true,
    price: 80,
    renewalPrice: 80,
    currency: "USD",
  });

  assert.equal(store.countAvailableBrowse({}), 3);
  assert.equal(store.countAvailableBrowse({ form: "singular" }), 2);
  assert.equal(store.countAvailableBrowse({ form: "plural" }), 1);
  assert.equal(store.countAvailableBrowse({ premium: "premium" }), 1);
  assert.equal(store.countAvailableBrowse({ premium: "no-premium" }), 2);
  assert.equal(store.countAvailableBrowse({ maxPrice: 20 }), 1);
  assert.equal(store.countAvailableBrowse({ maxLen: 5 }), 1);
  assert.equal(store.countAvailableBrowse({ term: "gal" }), 1);
  assert.deepEqual(
    store.availableBrowsePage({ sort: "price" }, 3, 0).map((row) => row.word),
    ["orbit", "orbits", "galaxy"],
  );
  assert.equal(store.availableBrowsePage({ sort: "commercial" }, 2, 0).length, 2);
  assert.equal(store.standardPrices().get("dev"), 12);
  store.close();
});
