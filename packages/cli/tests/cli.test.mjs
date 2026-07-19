import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const cli = new URL("../dist/cli.js", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli.pathname, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

test("prints the package version", () => {
  assert.equal(run(["--version"]).trim(), pkg.version);
});

test("shows the single-word commands", () => {
  const output = run(["--help"]);
  assert.match(output, /unclaimed check <domain\|word>/);
  assert.match(output, /unclaimed refresh \[--all\]/);
  assert.match(output, /default TLDs:.*md/);
});

test("keeps the bare command headless without a TTY", () => {
  const output = run([]);
  assert.match(output, /unclaimed - find and track single-word domains/);
  assert.doesNotMatch(output, /find a word\. see what's unclaimed\./);
});

test("uses XDG paths and creates an empty database", () => {
  const root = mkdtempSync(join(tmpdir(), "unclaimed-"));
  const env = {
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
  };
  const config = JSON.parse(run(["config"], env));
  assert.equal(config.database, join(root, "data", "unclaimed", "domains.db"));
  assert.match(run(["stats"], env), /total tracked:\s+0/);
});
