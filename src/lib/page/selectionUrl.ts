import { useEffect } from "react";

import type { Selection } from "@/lib/page/selection";

/** The address of a selection (PRD 3): an open room has its own URL, everything else is the map. */
export function pathForSelection(selection: Selection): string {
  return selection.kind === "room" ? `/room/${selection.room.id}` : "/";
}

/**
 * Keeps the address bar on the selection without navigating (chunk 12).
 * `replaceState` adds no history entry, so Back leaves the app instead of
 * stepping through rooms, and Next's router picks the new path up without
 * fetching or remounting anything. A reload then lands on `/room/<id>`, which
 * renders this same shell with the room open.
 */
export function useSelectionUrl(selection: Selection): void {
  const path = pathForSelection(selection);
  useEffect(() => {
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
  }, [path]);
}
