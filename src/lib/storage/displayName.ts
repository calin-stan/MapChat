/**
 * The remembered display name (PRD 6.7): one localStorage key, read on
 * mount, written after every successful submit. Every storage access is
 * wrapped so a missing or blocked storage API degrades to "not remembered":
 * the server has no localStorage, Node has none without a flag, and a
 * browser can throw a SecurityError when site data is blocked.
 *
 * Subscribers exist so React can observe the value through
 * `useSyncExternalStore` (see `useDisplayName`).
 */

export const DISPLAY_NAME_KEY = "mapchat.displayName";

type Listener = () => void;

const listeners = new Set<Listener>();

/** The storage object, or null when there is none or access is blocked. */
function storage(): Storage | null {
  try {
    const candidate: Storage | undefined = globalThis.localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/** The stored name, or null when nothing is stored or storage is unavailable. */
export function readDisplayName(): string | null {
  try {
    const value = storage()?.getItem(DISPLAY_NAME_KEY) ?? null;
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Remembers `name` for the next visit and notifies subscribers. A failed
 * write (blocked storage, quota) is swallowed: the name is simply not
 * remembered. Subscribers are notified either way so a hook re-reads.
 */
export function writeDisplayName(name: string): void {
  try {
    storage()?.setItem(DISPLAY_NAME_KEY, name);
  } catch {
    // Not remembered; the form still works for this visit.
  }
  for (const listener of listeners) listener();
}

/**
 * Calls `listener` after every `writeDisplayName` in this tab and after
 * another tab changes the key (or clears storage). Returns the unsubscribe
 * function. Shaped for `useSyncExternalStore`; safe without a window.
 */
export function subscribeDisplayName(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DISPLAY_NAME_KEY) listener();
  };
  const target = typeof window === "undefined" ? undefined : window;
  target?.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    target?.removeEventListener("storage", onStorage);
  };
}
