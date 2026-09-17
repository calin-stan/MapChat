import type { Message } from "@/lib/schemas/types";

/**
 * Pure scroll decisions of the message list (room-panel design §5). jsdom has
 * no layout, so the rules live here as functions; `MessageList` only measures
 * the DOM, asks these functions, and applies the answer.
 */

export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

export const NEAR_BOTTOM_PX = 32;

/** `scrollHeight - scrollTop - clientHeight <= threshold` */
export function isNearBottom(m: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

export type ListChange = {
  /** The first nonempty snapshot. Its rows are history, not additions. */
  initial: boolean;
  /** Newly added ids before the previous first row. */
  before: string[];
  /** Newly added ids between previous rows. */
  within: string[];
  /** Newly added ids after the previous last row. */
  after: string[];
};

/**
 * Compares two committed snapshots by their full id sets. Only unseen ids
 * count; a new array with the same ids is not a change. Both lists are in the
 * feed's chronological order, and rows are never removed.
 */
export function classifyChange(prev: readonly Message[], next: readonly Message[]): ListChange {
  const change: ListChange = { initial: false, before: [], within: [], after: [] };
  if (prev.length === 0) {
    change.initial = next.length > 0;
    return change;
  }
  const known = new Set(prev.map((message) => message.id));
  const firstId = prev[0].id;
  const lastId = prev[prev.length - 1].id;
  let zone: "before" | "within" | "after" = "before";
  for (const { id } of next) {
    if (id === firstId) zone = "within";
    if (!known.has(id)) change[zone].push(id);
    if (id === lastId) zone = "after";
  }
  return change;
}

/** `within` and `after` are incoming messages; `before` is older history. */
export function hasIncoming(change: ListChange): boolean {
  return change.within.length > 0 || change.after.length > 0;
}

export type ScrollDecision = {
  /** `bottom`: jump to the newest row. `anchor`: keep the reader's visible row where it was. */
  scroll: "bottom" | "anchor";
  pill: "show" | "clear" | "keep";
};

/** The priority table of room-panel design §5.1, for one committed update. */
export function decideScroll(input: {
  change: ListChange;
  /** An explicit request (own send, pill click) whose row is in this commit. */
  bottomRequested: boolean;
  /** A manual "Load more messages" hold is active. */
  holding: boolean;
  /** Measured before this update. */
  wasNearBottom: boolean;
}): ScrollDecision {
  if (input.bottomRequested) return { scroll: "bottom", pill: "clear" };
  if (input.change.initial) return { scroll: "bottom", pill: "clear" };
  if (hasIncoming(input.change)) {
    if (input.holding) return { scroll: "anchor", pill: "show" };
    if (input.wasNearBottom) return { scroll: "bottom", pill: "clear" };
    return { scroll: "anchor", pill: "show" };
  }
  // Only older rows, or nothing new: keep the reading position, leave the pill alone.
  return { scroll: "anchor", pill: "keep" };
}

/** When the list's own height changes (the footer grew or shrank). */
export function decideResize(input: { holding: boolean; wasNearBottom: boolean }): "bottom" | "anchor" {
  return input.wasNearBottom && !input.holding ? "bottom" : "anchor";
}

/** A row's box relative to the top edge of the list viewport. */
export type RowBox = { id: string; top: number; bottom: number };

/** The reader's position: a row and its top offset, negative when partly scrolled out. */
export type Anchor = { id: string; offset: number };

/** The first row with any part inside the viewport, in document order. Lazy: stops at the hit. */
export function pickAnchor(rows: Iterable<RowBox>, viewportHeight: number): Anchor | null {
  for (const row of rows) {
    if (row.bottom > 0 && row.top < viewportHeight) return { id: row.id, offset: row.top };
  }
  return null;
}

/**
 * How far to move `scrollTop` so the anchor row returns to its old offset.
 * Only displacement above the row counts: 100 px added above and 100 px below
 * give 100, not 200.
 */
export function anchorAdjustment(anchor: Anchor, currentOffset: number): number {
  return currentOffset - anchor.offset;
}
