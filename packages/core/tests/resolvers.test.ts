import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDomain, configureResolvers, setWhoisTransport } from "../src/resolvers";

test("classifies an available WHOIS response", async () => {
  configureResolvers({ whois: { test: "whois.registry.test" } });
  setWhoisTransport(async (server) => {
    assert.equal(server, "whois.registry.test");
    return "No match for domain";
  });

  const result = await checkDomain("orbit.test", { source: "whois" });
  assert.equal(result.status, "available");
  assert.equal(result.source, "whois");
  assert.equal(result.expiry, null);
});

test("registered signals beat misleading sale copy", async () => {
  configureResolvers({ whois: { test: "whois.registry.test" } });
  setWhoisTransport(
    async () => `
    Creation Date: 2024-01-02T00:00:00Z
    Registry Expiry Date: 2027-01-02T00:00:00Z
    This domain is available for sale
    Name Server: NS1.EXAMPLE.COM
  `,
  );

  const result = await checkDomain("orbit.test", { source: "whois" });
  assert.equal(result.status, "registered");
  assert.equal(result.expiry, "2027-01-02T00:00:00.000Z");
  assert.equal(result.estimatedAvailable, "2027-03-23T00:00:00.000Z");
});

test("supports custom availability patterns", async () => {
  configureResolvers({
    whois: { custom: "whois.registry.custom" },
    availablePatterns: { custom: ["nothing allocated"] },
  });
  setWhoisTransport(async () => "Nothing allocated for that name");

  const result = await checkDomain("orbit.custom", { source: "whois" });
  assert.equal(result.status, "available");
});

test("transport failures stay unknown", async () => {
  configureResolvers({ whois: { test: "whois.registry.test" } });
  setWhoisTransport(async () => {
    throw new Error("timeout");
  });

  const result = await checkDomain("orbit.test", { source: "whois" });
  assert.equal(result.status, "unknown");
});

function ianaRecord(whoisValue: string, newline = "\r\n"): string {
  return [
    "domain:       PROBE",
    "organisation: Example Registry",
    "",
    `whois:        ${whoisValue}`,
    "",
    "status:       ACTIVE",
    "created:      2014-11-20",
    "",
  ].join(newline);
}

test("an empty IANA whois field does not consume the next line", async () => {
  const asked: string[] = [];
  setWhoisTransport(async (server) => {
    asked.push(server);
    return ianaRecord("");
  });

  const result = await checkDomain("orbit.probeempty", { source: "whois" });

  assert.equal(result.status, "unknown");
  assert.deepEqual(asked, ["whois.iana.org"]);
});

test("an IANA whois referral works with CRLF records", async () => {
  const asked: string[] = [];
  setWhoisTransport(async (server) => {
    asked.push(server);
    if (server === "whois.iana.org") return ianaRecord("whois.nic.probefull");
    return "No match for domain";
  });

  const result = await checkDomain("orbit.probefull", { source: "whois" });

  assert.equal(result.status, "available");
  assert.deepEqual(asked, ["whois.iana.org", "whois.nic.probefull"]);
});

test("an unconfirmed RDAP 404 stays unknown", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(null, { status: 404 });
  configureResolvers({
    rdap: { probeunconfirmed: "https://rdap.example/domain/{domain}" },
  });
  setWhoisTransport(async () => ianaRecord(""));

  const result = await checkDomain("orbit.probeunconfirmed");

  assert.equal(result.status, "unknown");
  assert.equal(result.source, "whois");
});

test("an RDAP 404 is available when WHOIS agrees", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(null, { status: 404 });
  configureResolvers({
    rdap: { probeconfirmed: "https://rdap.example/domain/{domain}" },
    whois: { probeconfirmed: "whois.registry.probeconfirmed" },
  });
  setWhoisTransport(async () => "No match for domain");

  const result = await checkDomain("orbit.probeconfirmed");

  assert.equal(result.status, "available");
  assert.equal(result.source, "rdap");
});
