import { type CheckResult, checkDomain } from "@unclaimed/core";
import type { DomainRow, ResultUpdate, Store } from "./store";

export type DatabaseUpdateMode = "backfill" | "refresh-selected" | "refresh-all";

export interface DatabaseUpdateProgress {
  done: number;
  total: number;
  available: number;
  changed: number;
}

export interface DatabaseUpdateSummary extends DatabaseUpdateProgress {
  added: number;
  cancelled: boolean;
}

export function resultUpdate(result: CheckResult): ResultUpdate {
  return {
    status: result.status,
    source: result.source,
    expiry: result.expiry,
    estimatedAvailable: result.estimatedAvailable,
    siteStatus: null,
    hasSite: null,
    coldOutreach: false,
    httpStatus: null,
    checkedAt: result.checkedAt,
  };
}

function unknownUpdate(): ResultUpdate {
  return {
    status: "unknown",
    source: null,
    expiry: null,
    estimatedAvailable: null,
    siteStatus: null,
    hasSite: null,
    coldOutreach: false,
    httpStatus: null,
    checkedAt: new Date().toISOString(),
  };
}

async function runRows(
  rows: DomainRow[],
  concurrency: number,
  signal: AbortSignal | undefined,
  visit: (row: DomainRow) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (cursor < rows.length && !signal?.aborted) {
      const index = cursor++;
      await visit(rows[index]);
    }
  });
  await Promise.all(workers);
}

export async function runDatabaseUpdate({
  mode,
  store,
  tlds,
  corpus,
  concurrency = 8,
  batchSize = 200,
  maxAttempts = 3,
  signal,
  check = checkDomain,
  onProgress,
}: {
  mode: DatabaseUpdateMode;
  store: Store;
  tlds: string[];
  corpus: string[];
  concurrency?: number;
  batchSize?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  check?: (domain: string) => Promise<CheckResult>;
  onProgress?: (progress: DatabaseUpdateProgress) => void;
}): Promise<DatabaseUpdateSummary> {
  const selectedTlds = mode === "refresh-all" ? store.trackedTlds() : tlds;
  const added = mode === "refresh-all" ? 0 : store.seed(corpus, selectedTlds);
  const total =
    mode === "backfill"
      ? store.countPending(selectedTlds, maxAttempts)
      : store.countTotal(selectedTlds);
  const progress: DatabaseUpdateProgress = { done: 0, total, available: 0, changed: 0 };
  onProgress?.({ ...progress });

  const visit = async (row: DomainRow) => {
    let update: ResultUpdate;
    try {
      update = resultUpdate(await check(row.domain));
    } catch {
      update = unknownUpdate();
    }
    const changed = store.applyResult(row, update, mode !== "backfill") === "flipped";
    progress.done++;
    if (update.status === "available") progress.available++;
    if (changed) progress.changed++;
    onProgress?.({ ...progress });
  };

  if (mode === "backfill") {
    while (!signal?.aborted) {
      const rows = store.pending(selectedTlds, maxAttempts, batchSize);
      if (!rows.length) break;
      await runRows(rows, concurrency, signal, visit);
    }
  } else {
    let cursor = "";
    while (!signal?.aborted) {
      const rows = store.refreshBatch(selectedTlds, cursor, batchSize);
      if (!rows.length) break;
      cursor = rows.at(-1)?.domain ?? cursor;
      await runRows(rows, concurrency, signal, visit);
    }
  }

  return { ...progress, added, cancelled: signal?.aborted ?? false };
}
