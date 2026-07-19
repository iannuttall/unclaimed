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
