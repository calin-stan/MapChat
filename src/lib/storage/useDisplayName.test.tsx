// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { DISPLAY_NAME_KEY } from "@/lib/storage/displayName";
import { useDisplayName } from "@/lib/storage/useDisplayName";

beforeEach(() => {
  localStorage.clear();
});

describe("useDisplayName", () => {
  it("is empty when nothing is stored", () => {
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBe("");
  });

  it("starts with the stored name", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBe("ann");
  });

  it("stores and re-renders through setName", () => {
    const { result } = renderHook(() => useDisplayName());

    act(() => result.current[1]("bob"));

    expect(result.current[0]).toBe("bob");
    expect(localStorage.getItem(DISPLAY_NAME_KEY)).toBe("bob");
  });

  it("keeps the same setName across renders", () => {
    const { result, rerender } = renderHook(() => useDisplayName());
    const setName = result.current[1];
    rerender();
    expect(result.current[1]).toBe(setName);
  });

  it("follows a change made by another tab", () => {
    const { result } = renderHook(() => useDisplayName());

    act(() => {
      localStorage.setItem(DISPLAY_NAME_KEY, "cat");
      window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_NAME_KEY }));
    });

    expect(result.current[0]).toBe("cat");
  });

  it("renders as empty on the server even when a name is stored", () => {
    localStorage.setItem(DISPLAY_NAME_KEY, "ann");
    function Probe() {
      const [name] = useDisplayName();
      return <span>{name === "" ? "(empty)" : name}</span>;
    }

    expect(renderToString(<Probe />)).toContain("(empty)");
  });
});
