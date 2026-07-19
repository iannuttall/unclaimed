import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserCommand,
  netimSearchUrl,
  porkbunSearchUrl,
  registrarSearchTarget,
} from "../src/open-browser";

test("builds a Porkbun search URL for one domain", () => {
  assert.equal(porkbunSearchUrl(" Orbit.Dev "), "https://porkbun.com/checkout/search?q=orbit.dev");
  assert.equal(
    netimSearchUrl(" Orbit.MD "),
    "https://www.netim.com/en/domain-name/search?domain=orbit.md",
  );
});

test("routes registrar searches without leaving a TLD uncovered", () => {
  const porkbunTlds = new Set(["dev", "so"]);
  assert.deepEqual(registrarSearchTarget("orbit.dev", "dev", porkbunTlds), {
    name: "Porkbun",
    url: "https://porkbun.com/checkout/search?q=orbit.dev",
  });
  assert.deepEqual(registrarSearchTarget("orbit.md", "md", porkbunTlds), {
    name: "Netim",
    url: "https://www.netim.com/en/domain-name/search?domain=orbit.md",
  });
  assert.deepEqual(registrarSearchTarget("orbit.so", "so", porkbunTlds), {
    name: "Netim",
    url: "https://www.netim.com/en/domain-name/search?domain=orbit.so",
  });
  assert.deepEqual(registrarSearchTarget("orbit.tools", "tools", porkbunTlds), {
    name: "Netim",
    url: "https://www.netim.com/en/domain-name/search?domain=orbit.tools",
  });
});

test("builds browser commands without a shell", () => {
  const url = porkbunSearchUrl("orbit.dev");
  assert.deepEqual(browserCommand(url, "darwin"), { command: "open", args: [url] });
  assert.deepEqual(browserCommand(url, "linux"), { command: "xdg-open", args: [url] });
  assert.deepEqual(browserCommand(url, "win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "start", "", url],
  });
});
