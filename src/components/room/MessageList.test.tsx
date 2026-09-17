// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageList, type MessageListHandle, type MessageListProps } from "@/components/room/MessageList";
import { msg } from "@/lib/feed/test-helpers";
import type { Message } from "@/lib/schemas/types";

// jsdom has no layout. This fake gives the list a 200 px viewport, every row
// 50 px and the "Load older" block 40 px, and clamps scrollTop like a browser.
const VIEWPORT = 200;
const ROW = 50;
const LOAD_OLDER = 40;

const scrollTops = new WeakMap<Element, number>();
const isList = (el: Element) => el.getAttribute("role") === "log";
const rowsIn = (list: Element) => Array.from(list.querySelectorAll("[data-message-id]"));
const headerHeight = (list: Element) => (list.querySelector("button") ? LOAD_OLDER : 0);
const contentHeight = (list: Element) => headerHeight(list) + rowsIn(list).length * ROW;

function installFakeLayout() {
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get(this: HTMLElement) { return isList(this) ? VIEWPORT : 0; } },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isList(this) ? contentHeight(this) : 0; } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return scrollTops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) {
        const max = Math.max(0, contentHeight(this) - VIEWPORT);
        scrollTops.set(this, Math.min(Math.max(0, value), max));
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const list = this.closest('[role="log"]');
    const index = list ? rowsIn(list).indexOf(this) : -1;
    if (!list || index < 0) return new DOMRect(0, 0, 300, isList(this) ? VIEWPORT : 0);
    const top = headerHeight(list) + index * ROW - (scrollTops.get(list) ?? 0);
    return new DOMRect(0, top, 300, ROW);
  });
}

function removeFakeLayout() {
  // The real accessors live on Element.prototype; deleting the overrides restores them.
  for (const key of ["clientHeight", "scrollHeight", "scrollTop"] as const) {
    delete (HTMLElement.prototype as Partial<HTMLElement>)[key];
  }
  vi.restoreAllMocks();
}

const many = (from: number, to: number): Message[] =>
  Array.from({ length: to - from + 1 }, (_, index) => msg(from + index));

function setup(initial: Partial<MessageListProps> = {}) {
  const ref = createRef<MessageListHandle>();
  const onLoadOlder = vi.fn();
  const props: MessageListProps = { messages: [], hasOlder: false, loading: null, onLoadOlder, ...initial };
  const view = render(<MessageList ref={ref} {...props} />);
  const list = screen.getByRole("log");
  return {
    ref,
    list,
    onLoadOlder,
    update(next: Partial<MessageListProps>) {
      Object.assign(props, next);
      view.rerender(<MessageList ref={ref} {...props} />);
    },
    /** The reader scrolls: move, then the browser's scroll event. */
    userScrollTo(top: number) {
      list.scrollTop = top;
      fireEvent.scroll(list);
    },
    /** Top offset of a row inside the list viewport. */
    offsetOf: (n: number) =>
      screen.getByText(`message ${n}`).closest("[data-message-id]")!.getBoundingClientRect().top,
    pill: () => screen.queryByRole("button", { name: "New messages" }),
    unmount: view.unmount,
  };
}

const bottomOf = (list: HTMLElement) => list.scrollHeight - VIEWPORT;

beforeEach(installFakeLayout);
afterEach(removeFakeLayout);

describe("MessageList rendering", () => {
  it("is a polite log whose rows keep line breaks and show a machine-readable time", () => {
    const { list } = setup({ messages: [msg(1, { text: "two\nlines" })] });

    expect(list).toHaveAttribute("aria-live", "polite");
    expect(list).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("author-1")).toHaveClass("font-medium");
    expect(screen.getByText(/two\s+lines/)).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(list.querySelector("time")).toHaveAttribute("datetime", msg(1).createdAt);
  });

  it("hides Load older without older history", () => {
    setup({ messages: many(1, 3), hasOlder: false });
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("puts Load older first and reports clicks", () => {
    const { list, onLoadOlder } = setup({ messages: many(1, 3), hasOlder: true });
    const button = screen.getByRole("button", { name: "Load older" });

    fireEvent.click(button);

    expect(list.firstElementChild).toContainElement(button);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["older", true, true],
    ["newer", true, false],
    ["initial", true, false],
    [null, false, false],
  ] as const)("while loading %s: disabled %s, spinner %s", (loading, disabled, spinner) => {
    const { list } = setup({ messages: many(1, 3), hasOlder: true, loading });
    const button = screen.getByRole("button", { name: "Load older" });

    expect(button.hasAttribute("disabled")).toBe(disabled);
    expect(button.querySelector("svg") !== null).toBe(spinner);
    expect(list).toHaveAttribute("aria-busy", String(loading === "older"));
  });
});

describe("MessageList scrolling", () => {
  it("opens at the bottom of initial history", () => {
    const { list } = setup({ messages: many(1, 10) });
    expect(list.scrollTop).toBe(300); // 10 rows of 50 in a 200 px viewport
  });

  it("opens at the bottom when history arrives after an empty first render", () => {
    const { list, update, pill } = setup();
    update({ messages: many(1, 10) });

    expect(list.scrollTop).toBe(300);
    expect(pill()).toBeNull();
  });

  it("keeps the visible row in place when older rows are prepended", () => {
    const { list, update, userScrollTo, offsetOf, pill } = setup({ messages: many(11, 20), hasOlder: true });
    userScrollTo(65); // row 11 starts 25 px above the viewport's top edge
    expect(offsetOf(11)).toBe(-25);

    update({ messages: many(6, 20) });

    expect(offsetOf(11)).toBe(-25);
    expect(list.scrollTop).toBe(65 + 5 * ROW);
    expect(pill()).toBeNull();
  });

  it("keeps the visible row in place when Load older disappears", () => {
    const { update, userScrollTo, offsetOf } = setup({ messages: many(1, 10), hasOlder: true });
    userScrollTo(100);
    const before = offsetOf(3);

    update({ hasOlder: false });

    expect(offsetOf(3)).toBe(before);
  });

  it("follows an append when the reader is near the bottom", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(bottomOf(list) - 32);

    update({ messages: many(1, 11) });

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("shows the pill and leaves scrollTop alone for an append while scrolled up", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    update({ messages: many(1, 11) });

    expect(list.scrollTop).toBe(100);
    expect(pill()).toBeInTheDocument();
  });

  it("scrolls down and hides the pill when it is clicked", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    fireEvent.click(pill()!);

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("hides the pill when the reader scrolls to the bottom", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    userScrollTo(bottomOf(list) - 10);

    expect(pill()).toBeNull();
  });

  it("treats a same-ids array and a duplicate-only update as no change", () => {
    const { list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    update({ messages: [...many(1, 10)] });

    expect(list.scrollTop).toBe(100);
    expect(pill()).toBeNull();
  });

  it("applies the near-bottom and pill rules to interior additions", () => {
    const sparse = [msg(1), msg(2), msg(3), msg(4), msg(5), msg(6), msg(8)];
    const near = setup({ messages: sparse });
    near.update({ messages: many(1, 8) }); // 7 lands between 6 and 8
    expect(near.list.scrollTop).toBe(bottomOf(near.list));
    expect(near.pill()).toBeNull();
    near.unmount();

    const away = setup({ messages: sparse });
    away.userScrollTo(50);
    const before = away.offsetOf(2);
    away.update({ messages: many(1, 8) });
    expect(away.offsetOf(2)).toBe(before);
    expect(away.pill()).toBeInTheDocument();
  });

  it("adjusts by the rows above only when rows arrive above and below at once", () => {
    const { list, update, userScrollTo, offsetOf, pill } = setup({ messages: many(11, 20), hasOlder: true });
    userScrollTo(140); // row 13 is the first visible row
    const before = offsetOf(13);

    update({ messages: many(9, 22) }); // 100 px above and 100 px below in one commit

    expect(list.scrollTop).toBe(240); // +100, not +200
    expect(offsetOf(13)).toBe(before);
    expect(pill()).toBeInTheDocument();
  });

  it("does not let the scroll event of its own correction hide a new pill", () => {
    const sparse = [msg(1), msg(3), msg(4), msg(5), msg(6), msg(7), msg(8)];
    const { ref, list, update, pill } = setup({ messages: sparse });
    const finish = ref.current!.holdPosition(); // a hold keeps the position even at the bottom

    update({ messages: many(1, 8) }); // 2 lands above the visible rows: corrected by +50
    fireEvent.scroll(list); // the browser reports our own write
    expect(pill()).toBeInTheDocument();

    fireEvent.scroll(list); // a later event at the bottom is the reader's
    expect(pill()).toBeNull();
    act(finish);
  });

  it("keeps following the bottom when the list's height changes", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const { list, userScrollTo } = setup({ messages: many(1, 10) });
      const resize = () => act(() => observers[0]([], {} as ResizeObserver));

      list.scrollTop = 250; // the viewport shrank under a reader who was at the bottom
      resize();
      expect(list.scrollTop).toBe(bottomOf(list));

      userScrollTo(100);
      resize();
      expect(list.scrollTop).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MessageList handle", () => {
  it("scrollToBottom() jumps at once and clears the pill", () => {
    const { ref, list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });

    act(() => ref.current!.scrollToBottom());

    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("scrollToBottom(id) waits for that row to commit", () => {
    const { ref, list, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    act(() => ref.current!.scrollToBottom(msg(11).id));
    expect(list.scrollTop).toBe(100);

    update({ messages: many(1, 11) });
    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();
  });

  it("scrollToBottom(id) applies at once when the row is already there", () => {
    const { ref, list, userScrollTo } = setup({ messages: many(1, 10) });
    userScrollTo(100);

    act(() => ref.current!.scrollToBottom(msg(10).id));

    expect(list.scrollTop).toBe(bottomOf(list));
  });

  it("holds the position near the bottom, through an unrelated append and a final interior batch", () => {
    const sparse = [msg(1), msg(2), msg(3), msg(4), msg(6), msg(7), msg(8)];
    const { ref, list, update, pill } = setup({ messages: sparse });
    const atBottom = list.scrollTop;
    const finish = ref.current!.holdPosition();

    update({ messages: [...sparse, msg(9)] }); // unrelated arrival: does not consume the hold
    expect(list.scrollTop).toBe(atBottom);
    expect(pill()).toBeInTheDocument();

    // The request's batch lands between displayed rows; finish() runs before React commits it.
    act(() => {
      finish();
      update({ messages: many(1, 9) });
    });
    expect(list.scrollTop).toBe(atBottom);

    update({ messages: many(1, 10) }); // the hold is over: near the bottom follows again
    expect(list.scrollTop).toBe(atBottom); // 150 is more than 32 px from the new bottom
    expect(pill()).toBeInTheDocument();
  });

  it("releases a finished hold even when no commit brought rows (empty, failed or duplicate batch)", () => {
    const { ref, list, update, pill } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    act(finish); // request start and completion before any intermediate render
    act(finish); // idempotent
    expect(pill()).toBeNull();

    update({ messages: many(1, 11) });
    expect(list.scrollTop).toBe(bottomOf(list)); // following again
    expect(pill()).toBeNull();
  });

  it("keeps a pill from a separate arrival when the held batch was empty", () => {
    const { ref, update, userScrollTo, pill } = setup({ messages: many(1, 10) });
    userScrollTo(100);
    update({ messages: many(1, 11) });
    const finish = ref.current!.holdPosition();

    act(finish);

    expect(pill()).toBeInTheDocument();
  });

  it("lets an own send reach the bottom during a hold without ending the hold", () => {
    const { ref, list, update, pill } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    act(() => ref.current!.scrollToBottom(msg(12).id));
    update({ messages: [...many(1, 10), msg(12)] });
    expect(list.scrollTop).toBe(bottomOf(list));
    expect(pill()).toBeNull();

    const held = list.scrollTop;
    update({ messages: many(1, 12) }); // the manual batch: 11 lands inside
    expect(pill()).toBeInTheDocument();
    expect(list.scrollTop).toBe(held); // held in place: no longer following the new bottom
    expect(list.scrollTop).toBeLessThan(bottomOf(list));
    act(finish);
  });

  it("ignores a finish callback that outlives the list", () => {
    const { ref, unmount } = setup({ messages: many(1, 10) });
    const finish = ref.current!.holdPosition();

    unmount();

    expect(() => finish()).not.toThrow();
  });
});
