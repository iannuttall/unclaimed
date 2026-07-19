import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configureResolvers, type ResolverConfig } from "@unclaimed/core";

export const DEFAULT_TLDS = [
  "io",
  "ai",
  "dev",
  "app",
  "sh",
  "so",
  "md",
  "xyz",
  "run",
  "now",
  "build",
  "studio",
  "store",
  "link",
  "space",
  "live",
  "to",
];

export interface UserConfig extends ResolverConfig {
  tlds?: string[];
  database?: string;
}

export function configPath(): string {
  if (process.env.UNCLAIMED_CONFIG) return process.env.UNCLAIMED_CONFIG;
  const root = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(root, "unclaimed", "config.json");
}

export function dataPath(): string {
  if (process.env.UNCLAIMED_DB) return process.env.UNCLAIMED_DB;
  const root = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(root, "unclaimed", "domains.db");
}

export function loadConfig(): UserConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as UserConfig;
  configureResolvers(parsed);
  return parsed;
}

export function loadEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function readTldsFile(path: string): string[] {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return normalizeTlds(JSON.parse(raw) as string[]);
  return normalizeTlds(raw.split(/[\s,]+/));
}

export function normalizeTlds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/^\./, "").toLowerCase()))].filter(
    (value) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(value),
  );
}
