/**
 * Generic in-memory session store with TTL-based cleanup.
 * Sessions older than `ttlMs` are automatically pruned on access.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface SessionEntry<T> {
  data: T;
  createdAt: number;
}

export class SessionStore<T> {
  private readonly store = new Map<number | string, SessionEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: number | string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: number | string, data: T): void {
    this.store.set(key, { data, createdAt: Date.now() });
  }

  delete(key: number | string): void {
    this.store.delete(key);
  }

  has(key: number | string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove all expired entries from the store.
   */
  pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get the number of entries in the store (for debugging).
   */
  get size(): number {
    return this.store.size;
  }
}
