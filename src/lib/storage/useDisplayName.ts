import { useSyncExternalStore } from "react";

import {
  readDisplayName,
  subscribeDisplayName,
  writeDisplayName,
} from "@/lib/storage/displayName";

function getSnapshot(): string {
  return readDisplayName() ?? "";
}

function getServerSnapshot(): string {
  return "";
}

/**
 * The remembered display name as React state (PRD 6.7). It is "" on the
 * server and while hydrating, so server and client markup agree; React then
 * re-renders with the stored value. `setName` persists and notifies every
 * mounted hook in this tab; other tabs are picked up through `storage`
 * events. Uses `useSyncExternalStore` rather than an effect, which also
 * satisfies the `react-hooks/set-state-in-effect` lint rule.
 *
 * Call it from client components only.
 */
export function useDisplayName(): [name: string, setName: (name: string) => void] {
  const name = useSyncExternalStore(subscribeDisplayName, getSnapshot, getServerSnapshot);
  return [name, writeDisplayName];
}
