import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SessionStore } from "./session-store.js";

describe("SessionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves a value", () => {
    const store = new SessionStore<string>();
    store.set(1, "hello");
    expect(store.get(1)).toBe("hello");
  });

  it("returns undefined for missing key", () => {
    const store = new SessionStore<string>();
    expect(store.get(999)).toBeUndefined();
  });

  it("deletes a value", () => {
    const store = new SessionStore<string>();
    store.set(1, "hello");
    store.delete(1);
    expect(store.get(1)).toBeUndefined();
  });

  it("has() returns true for existing key", () => {
    const store = new SessionStore<string>();
    store.set(1, "hello");
    expect(store.has(1)).toBe(true);
  });

  it("prunes expired entries on get", () => {
    const store = new SessionStore<string>(1000); // 1 second TTL
    store.set(1, "short-lived");

    vi.advanceTimersByTime(1500);

    expect(store.get(1)).toBeUndefined();
  });

  it("keeps non-expired entries", () => {
    const store = new SessionStore<string>(5000);
    store.set(1, "alive");

    vi.advanceTimersByTime(3000);

    expect(store.get(1)).toBe("alive");
  });

  it("prunes only expired entries, keeps fresh ones", () => {
    const store = new SessionStore<string>(2000);
    store.set(1, "old");

    vi.advanceTimersByTime(1500);
    store.set(2, "new");

    vi.advanceTimersByTime(600); // total: 2100ms for key 1, 600ms for key 2

    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBe("new");
  });
});
