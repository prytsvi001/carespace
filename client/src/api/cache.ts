// client/src/api/cache.ts
// Tiny in-memory TTL cache for GET endpoints whose data rarely changes mid-session
// (agents roster, shortcuts library, KPI settings) — no new dependency, just a
// module-level Map that survives across tab remounts within the same page load.
// Concurrent callers for the same key while a fetch is in flight share one promise
// instead of firing duplicate requests (e.g. two tabs mounting getAgents() at once).
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const entry = store.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return Promise.resolve(entry.data as T);
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((data) => {
      store.set(key, { data, expiresAt: Date.now() + ttlMs });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

// Call after any mutation that could make a cached key stale (create/update/delete).
export function invalidateCache(key: string): void {
  store.delete(key);
}
