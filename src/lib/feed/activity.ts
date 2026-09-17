/** What counts as the visitor using the room (PRD 6.4). `scroll` does not bubble, so it is captured. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

const optionsFor = (type: (typeof ACTIVITY_EVENTS)[number]) => ({ passive: true, capture: type === "scroll" });

/**
 * Calls `onActivity` for pointer, keyboard, wheel, scroll and touch events
 * inside `el` (room-feed design §8). Returns the detach function. Document
 * visibility is not tracked here: `useRoomFeed` owns it.
 */
export function attachActivityTracking(
  el: HTMLElement,
  handlers: { onActivity(): void; ignoreScroll?(target: EventTarget | null): boolean },
): () => void {
  const listener = (event: Event) => {
    if (event.type === "scroll" && handlers.ignoreScroll?.(event.target)) return;
    handlers.onActivity();
  };
  for (const type of ACTIVITY_EVENTS) el.addEventListener(type, listener, optionsFor(type));
  return () => {
    for (const type of ACTIVITY_EVENTS) el.removeEventListener(type, listener, optionsFor(type));
  };
}
