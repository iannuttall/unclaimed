import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CheckResult } from "@unclaimed/core";
import { runDatabaseUpdate } from "../src/database-update";
import { openStore } from "../src/open-store";

function result(domain: string, status: CheckResult["status"]): CheckResult {
  return {
    domain,
    tld: domain.split(".").slice(1).join("."),
    status,
    source: "rdap",
    expiry: null,
    estimatedAvailable: null,
    checkedAt: new Date().toISOString(),
  };
}

test("backfill seeds and checks only unresolved rows", async () => {
  const root = mkdtempSync(join(tmpdir(), "unclaimed-update-"));
  const store = await openStore(join(root, "domains.db"));
  const checked: string[] = [];
  const check = async (domain: string) => {
    checked.push(domain);
    return result(domain, "available");
  };

  const first = await runDatabaseUpdate({
    mode: "backfill",
    store,
    tlds: ["dev", "io"],
    corpus: ["orbit", "pixel"],
    check,
  });
  assert.equal(first.added, 4);
  assert.equal(first.done, 4);
  assert.equal(first.available, 4);

  const second = await runDatabaseUpdate({
    mode: "backfill",
    store,
    tlds: ["dev", "io"],
    corpus: ["orbit", "pixel"],
    check,
  });
  assert.equal(second.added, 0);
  assert.equal(second.done, 0);
  assert.equal(checked.length, 4);
  store.close();
});

test("selected refresh preserves a known result when a check fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "unclaimed-update-"));
  const store = await openStore(join(root, "domains.db"));
  store.seed(["orbit"], ["dev"]);
  const row = store.forWord("orbit", ["dev"])[0];
  store.applyResult(row, {
    status: "available",
    source: "rdap",
    expiry: null,
    estimatedAvailable: null,
    siteStatus: null,
    hasSite: null,
    coldOutreach: false,
    httpStatus: null,
    checkedAt: new Date().toISOString(),
  });

  const summary = await runDatabaseUpdate({
    mode: "refresh-selected",
    store,
    tlds: ["dev"],
    corpus: ["orbit"],
    check: async () => {
      throw new Error("registry timeout");
    },
  });
  assert.equal(summary.done, 1);
  assert.equal(store.forWord("orbit", ["dev"])[0].status, "available");
  store.close();
});

test("full refresh includes every TLD already in the database", async () => {
  const root = mkdtempSync(join(tmpdir(), "unclaimed-update-"));
  const store = await openStore(join(root, "domains.db"));
  store.seed(["orbit"], ["dev", "tools"]);
  const checked: string[] = [];

  const summary = await runDatabaseUpdate({
    mode: "refresh-all",
    store,
    tlds: ["dev"],
    corpus: ["orbit"],
    check: async (domain) => {
      checked.push(domain);
      return result(domain, "registered");
    },
  });
  assert.equal(summary.done, 2);
  assert.deepEqual(checked.sort(), ["orbit.dev", "orbit.tools"]);
  store.close();
});
