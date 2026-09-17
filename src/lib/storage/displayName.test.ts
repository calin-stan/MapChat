// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISPLAY_NAME_KEY,
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the next storage calls throw, as a browser does when site data is blocked. */
function blocked(method: "getItem" | "setItem") {
  const error = new DOMException("storage is blocked", "SecurityError");
  const throwing = () => {
    throw error;
  };
  if (method === "getItem") vi.spyOn(Storage.prototype, "getItem").mockImplementation(throwing);
  else vi.spyOn(Storage.prototype, "setItem").mockImplementation(throwing);
}

describe("readDisplayName", () => {
  it("returns null when nothing is stored", () => {
    expect(readDisplayName()).toBeNull();
  });

  it("returns the stored name", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    expect(readDisplayName()).toBe("ann");
  });

  it("treats an empty stored value as nothing", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "");
    expect(readDisplayName()).toBeNull();
  });

  it("returns null when storage access throws", () => {
    blocked("getItem");
    expect(readDisplayName()).toBeNull();
  });
});

describe("writeDisplayName", () => {
  it("stores the name under the key", () => {
    writeDisplayName("ann");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("ann");
    expect(readDisplayName()).toBe("ann");
  });

  it("overwrites a previous name", () => {
    writeDisplayName("ann");
    writeDisplayName("bob");
    expect(readDisplayName()).toBe("bob");
  });

  it("swallows a failed write and is then not remembered", () => {
    blocked("setItem");
    expect(() => writeDisplayName("ann")).not.toThrow();
    vi.restoreAllMocks();
    expect(readDisplayName()).toBeNull();
  });

  it("notifies subscribers after a write, even a failed one", () => {
    const calls: string[] = [];
    const unsubscribe = subscribeDisplayName(() => calls.push(readDisplayName() ?? "(none)"));

    writeDisplayName("ann");
    blocked("setItem");
    writeDisplayName("bob");
    unsubscribe();

    expect(calls).toEqual(["ann", "ann"]);
  });
});

describe("subscribeDisplayName", () => {
  it("notifies on a storage event for the key or a clear, not for other keys", () => {
    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });

    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));
    expect(count).toBe(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(count).toBe(1);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(count).toBe(2);

    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });
    unsubscribe();

    writeDisplayName("ann");
    window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));

    expect(count).toBe(0);
  });

  it("keeps other subscribers when one unsubscribes", () => {
    const seen: string[] = [];
    const first = subscribeDisplayName(() => seen.push("first"));
    const second = subscribeDisplayName(() => seen.push("second"));
    first();

    writeDisplayName("ann");
    second();

    expect(seen).toEqual(["second"]);
  });
});
