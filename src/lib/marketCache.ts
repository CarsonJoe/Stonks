/**
 * Module-level in-memory cache for market API responses.
 * Survives React unmounts/remounts (tab switches) for the browser session.
 * TTL: 10 minutes.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data: data as unknown, fetchedAt: Date.now() });
}

/** Age of a cache entry in milliseconds, or null if not cached. */
export function cacheAgeMs(key: string): number | null {
  const entry = store.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.fetchedAt;
  return age > CACHE_TTL_MS ? null : age;
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function invalidateAll(): void {
  store.clear();
}
