import { createConnection } from "node:net";

/**
 * Raw WHOIS query over TCP port 43. Register it via setWhoisTransport() in
 * resolvers.ts so the core resolver stays independent from node:net.
 */
export function whoisQuery(server: string, domain: string, timeoutMs = 8000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let out = "";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(out);
    };

    const socket = createConnection({ host: server, port: 43 }, () => {
      socket.write(`${domain}\r\n`);
    });
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk: string) => {
      out += chunk;
    });
    socket.on("end", () => finish());
    socket.on("close", () => finish());
    socket.on("timeout", () => finish(new Error("whois timeout")));
    socket.on("error", (e: Error) => finish(e));
  });
}
