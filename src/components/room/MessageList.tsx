"use client";

import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";

import { LoadOlderButton } from "@/components/room/LoadOlderButton";
import { MessageItem } from "@/components/room/MessageItem";
import {
  anchorAdjustment,
  classifyChange,
  decideResize,
  decideScroll,
  isNearBottom,
  pickAnchor,
  type Anchor,
  type RowBox,
} from "@/components/room/listScroll";
import { Button } from "@/components/ui/button";
import type { FeedState } from "@/lib/feed/types";
import type { Message } from "@/lib/schemas/types";

export type MessageListProps = {
  messages: Message[];
  hasOlder: boolean;
  loading: FeedState["inflight"];
  onLoadOlder(): void;
  /** Reader scrolling only; automatic following/anchoring must not count as activity. */
  onUserScroll?(): void;
  ref?: Ref<MessageListHandle>;
};

export type MessageListHandle = {
  /** Jump to the newest row; with an id, once that row has committed. */
  scrollToBottom(messageId?: string): void;
  /** Start a manual-load hold; the returned callback finishes it and is idempotent. */
  holdPosition(): () => void;
  /** The panel delegates this target's activity classification to MessageList. */
  ownsScrollTarget(target: EventTarget | null): boolean;
};

/** One manual "Load more messages" request. Released by the commit after it finishes. */
type Hold = { finishing: boolean };

function rowElements(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[data-message-id]"));
}

/** Row boxes relative to the list viewport, measured one at a time. */
function* rowBoxes(list: HTMLElement): Generator<RowBox> {
  const viewportTop = list.getBoundingClientRect().top;
  for (const row of rowElements(list)) {
    const rect = row.getBoundingClientRect();
    yield { id: row.dataset.messageId ?? "", top: rect.top - viewportTop, bottom: rect.bottom - viewportTop };
  }
}

function offsetOf(list: HTMLElement, id: string): number | null {
  const row = rowElements(list).find((element) => element.dataset.messageId === id);
  if (!row) return null;
  return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
}

/**
 * The conversation's scroll container (room-panel design §5). It measures the
 * DOM and applies what `listScroll` decides: initial history and own sends go
 * to the bottom, incoming rows follow only a reader who is already there, and
 * otherwise the first visible row keeps its place and the "New messages" pill
 * shows. Browser scroll anchoring is off, so displacement is corrected once.
 */
export function MessageList({ messages, hasOlder, loading, onLoadOlder, onUserScroll, ref }: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState(false);
  const [holdTick, setHoldTick] = useState(0);

  // Measurements and requests live in refs: they describe the committed DOM,
  // so an abandoned render can never overwrite them.
  const committed = useRef<readonly Message[]>([]);
  const anchor = useRef<Anchor | null>(null);
  const nearBottom = useRef(true);
  const holds = useRef(new Set<Hold>());
  const bottomRequest = useRef<{ id?: string } | null>(null);
  /** `scrollTop` right after our own write, to tell its scroll event from the reader's. */
  const ownScrollTop = useRef<number | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    nearBottom.current = isNearBottom(list);
    anchor.current = pickAnchor(rowBoxes(list), list.clientHeight);
  }, []);

  const writeScrollTop = useCallback((list: HTMLElement, value: number) => {
    const before = list.scrollTop;
    list.scrollTop = value;
    if (list.scrollTop !== before) ownScrollTop.current = list.scrollTop;
  }, []);

  const apply = useCallback(
    (scroll: "bottom" | "anchor") => {
      const list = listRef.current;
      if (!list) return;
      if (scroll === "bottom") {
        writeScrollTop(list, list.scrollHeight);
      } else if (anchor.current) {
        const offset = offsetOf(list, anchor.current.id);
        const delta = offset === null ? 0 : anchorAdjustment(anchor.current, offset);
        if (delta !== 0) writeScrollTop(list, list.scrollTop + delta);
      }
      // With no visible row the browser keeps scrollTop, clamped to the new range.
      measure();
    },
    [measure, writeScrollTop],
  );

  // Reconcile each commit that can move rows: new messages, "Load older" appearing or
  // going, and the tick of a finished hold. Additions are found by id, never inferred
  // from endpoints or loading flags.
  useLayoutEffect(() => {
    const change = classifyChange(committed.current, messages);
    committed.current = messages;

    const request = bottomRequest.current;
    const bottomRequested =
      request !== null && (request.id === undefined || messages.some((m) => m.id === request.id));
    if (bottomRequested) bottomRequest.current = null;

    const decision = decideScroll({
      change,
      bottomRequested,
      holding: holds.current.size > 0,
      wasNearBottom: nearBottom.current,
    });
    apply(decision.scroll);
    if (decision.pill === "show") setPill(true);
    if (decision.pill === "clear") setPill(false);

    // A finished hold has now seen the final snapshot of its request.
    for (const hold of [...holds.current]) if (hold.finishing) holds.current.delete(hold);
  }, [messages, hasOlder, holdTick, apply]);

  // The list's own height changes when the footer grows or shrinks.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      apply(decideResize({ holding: holds.current.size > 0, wasNearBottom: nearBottom.current }));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [apply]);

  useImperativeHandle(
    ref,
    () => ({
      ownsScrollTarget: (target) => listRef.current !== null && target === listRef.current,
      scrollToBottom(messageId) {
        const present = messageId === undefined || committed.current.some((m) => m.id === messageId);
        if (!present) {
          bottomRequest.current = { id: messageId }; // applied by the commit that brings the row
          return;
        }
        apply("bottom");
        setPill(false);
      },
      holdPosition() {
        const hold: Hold = { finishing: false };
        holds.current.add(hold);
        return () => {
          if (hold.finishing) return;
          hold.finishing = true;
          // Force a commit: it reconciles the request's final snapshot under the hold, then releases it.
          setHoldTick((tick) => tick + 1);
        };
      },
    }),
    [apply],
  );

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const own = ownScrollTop.current !== null && Math.abs(list.scrollTop - ownScrollTop.current) < 1;
    ownScrollTop.current = null;
    measure();
    // Only reader scrolling counts as activity or hides the pill.
    if (!own) {
      onUserScroll?.();
      if (nearBottom.current) setPill(false);
    }
  }

  return (
    <div className="relative flex min-h-24 flex-1 flex-col">
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-busy={loading === "older"}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
      >
        {hasOlder ? (
          <LoadOlderButton disabled={loading !== null} busy={loading === "older"} onClick={onLoadOlder} />
        ) : null}
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
      {pill ? (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            apply("bottom");
            setPill(false);
          }}
        >
          New messages
        </Button>
      ) : null}
    </div>
  );
}
