import type { Store } from "./store";

export async function openStore(path: string): Promise<Store> {
  const emitWarning = process.emitWarning;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  try {
    const { Store: SqliteStore } = await import("./store");
    return new SqliteStore(path);
  } finally {
    process.emitWarning = emitWarning;
  }
}
