import { describe, expect, it } from "vitest";

import {
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

// Server rendering and the Node test environment have neither localStorage
// nor window. Every function must degrade to "not remembered" (PRD 6.7).
describe("displayName without a DOM", () => {
  it("runs where there is no storage and no window", () => {
    expect(typeof globalThis.localStorage).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("reads null, writes without throwing and still notifies", () => {
    expect(readDisplayName()).toBeNull();

    let count = 0;
    const unsubscribe = subscribeDisplayName(() => {
      count += 1;
    });
    expect(() => writeDisplayName("ann")).not.toThrow();
    unsubscribe();

    expect(count).toBe(1);
    expect(readDisplayName()).toBeNull();
  });
});
