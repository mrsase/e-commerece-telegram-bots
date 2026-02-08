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
  private readonly store = new Map<number, SessionEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: number): T | undefined {
    this.pruneExpired();
    const entry = this.store.get(key);
    if (!entry) return undefined;
    return entry.data;
  }

  set(key: number, data: T): void {
    this.store.set(key, { data, createdAt: Date.now() });
  }

  delete(key: number): void {
    this.store.delete(key);
  }

  has(key: number): boolean {
    this.pruneExpired();
    return this.store.has(key);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}
