import { createHash } from "node:crypto";

// Bounded process-local reuse. Successful stages survive retries for 15 minutes;
// rejected promises are removed immediately. Pending work is never evicted.
export function createReportCache<T>(
  options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
) {
  const entries = new Map<
    string,
    { promise: Promise<T>; expires: number; pending: boolean }
  >();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 64;
  const ttlMs = options.ttlMs ?? 15 * 60 * 1000;
  return (key: string, generate: () => Promise<T>): Promise<T> => {
    for (const [id, entry] of entries)
      if (!entry.pending && entry.expires <= now()) entries.delete(id);
    const cached = entries.get(key);
    if (cached) return cached.promise;
    if (entries.size >= maxEntries) {
      const settled = [...entries].find(([, entry]) => !entry.pending);
      if (!settled) throw new Error("Report generation is busy. Try again.");
      entries.delete(settled[0]);
    }
    const entry: { promise: Promise<T>; expires: number; pending: boolean } = {
      promise: Promise.resolve(undefined as T),
      expires: Infinity,
      pending: true,
    };
    entry.promise = Promise.resolve()
      .then(generate)
      .then(
        (value) => {
          entry.pending = false;
          entry.expires = now() + ttlMs;
          return value;
        },
        (error: unknown) => {
          entries.delete(key);
          throw error;
        },
      );
    // A warmed stage may fail before a browser asks for it.
    void entry.promise.catch(() => {});
    entries.set(key, entry);
    return entry.promise;
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}

export function reportCacheKey(input: {
  resourceId: string;
  threadId: string;
  transcript: string;
  additionalContext?: Record<string, unknown>;
  provider: string;
  model: string;
  promptVersion: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
}
