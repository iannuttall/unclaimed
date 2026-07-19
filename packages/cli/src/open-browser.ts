import { spawn } from "node:child_process";

export function porkbunSearchUrl(domain: string): string {
  const url = new URL("https://porkbun.com/checkout/search");
  url.searchParams.set("q", domain.trim().toLowerCase());
  return url.toString();
}

export function netimSearchUrl(domain: string): string {
  const url = new URL("https://www.netim.com/en/domain-name/search");
  url.searchParams.set("domain", domain.trim().toLowerCase());
  return url.toString();
}

export const NETIM_PREFERRED_TLDS: ReadonlySet<string> = new Set(["md", "so"]);

export function registrarSearchTarget(
  domain: string,
  tld: string,
  porkbunTlds: ReadonlySet<string>,
): { name: "Porkbun" | "Netim"; url: string } {
  if (!NETIM_PREFERRED_TLDS.has(tld) && porkbunTlds.has(tld)) {
    return { name: "Porkbun", url: porkbunSearchUrl(domain) };
  }
  return { name: "Netim", url: netimSearchUrl(domain) };
}

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string): Promise<void> {
  const target = browserCommand(url);
  return new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
