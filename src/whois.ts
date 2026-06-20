import { connect } from "cloudflare:sockets";

/**
 * Raw WHOIS query over TCP port 43 — Cloudflare Workers transport.
 *
 * Workers open outbound TCP sockets via `connect()`, which reaches registry
 * WHOIS servers that have no RDAP endpoint (e.g. .md). Protocol: send
 * "<domain>\r\n", read plaintext back until the server closes the connection.
 *
 * The Node CLI uses the equivalent `node:net` transport in ./whois-node.ts.
 * Register whichever fits via setWhoisTransport() in resolvers.ts.
 */
export async function whoisQuery(
  server: string,
  domain: string,
  timeoutMs = 8000,
): Promise<string> {
  const socket = connect(
    { hostname: server, port: 43 },
    { secureTransport: "off", allowHalfOpen: true },
  );

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const writer = socket.writable.getWriter();
  await writer.write(encoder.encode(domain + "\r\n"));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let out = "";

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("whois timeout")), timeoutMs),
  );

  try {
    while (true) {
      const result = (await Promise.race([
        reader.read(),
        timeout,
      ])) as ReadableStreamReadResult<Uint8Array>;
      if (result.done) break;
      if (result.value) out += decoder.decode(result.value, { stream: true });
    }
  } finally {
    try {
      await socket.close();
    } catch {
      /* socket already closed by peer */
    }
  }

  return out;
}
