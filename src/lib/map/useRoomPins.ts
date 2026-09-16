import { useCallback, useEffect, useRef, useState } from "react";

import { type Api, api as defaultApi } from "@/lib/api/client";
import { getClientConfig } from "@/lib/config/client";
import {
  mergeBoxResults,
  sortRoomsNewestFirst,
  toQueryBoxes,
  type Viewport,
} from "@/lib/map/viewport";
import type { Room } from "@/lib/schemas/types";

/** How long the map must be still before a viewport change fetches pins (spec §5.2). */
export const DEFAULT_DEBOUNCE_MS = 250;

/** `loading` only before the first result; background refreshes keep `ready` or `error`. */
export type PinsStatus = "idle" | "loading" | "ready" | "error";

export type RoomPins = {
  rooms: Room[];
  truncated: boolean;
  status: PinsStatus;
  /** Invalidates old results immediately; debounced except for the first visible viewport. */
  setViewport(viewport: Viewport): void;
  /** Explicit refresh; replaces pending work, no-op before a viewport or while hidden. */
  refresh(): void;
  /** Merge one room locally by id and re-sort; no request, `truncated` unchanged. */
  insertRoom(room: Room): void;
};

export type UseRoomPinsDeps = { api?: Api; intervalMs?: number; debounceMs?: number };

type PinsState = { rooms: Room[]; truncated: boolean; status: PinsStatus };
type RequestOwner = { generation: number; sequence: number };

const INITIAL: PinsState = { rooms: [], truncated: false, status: "idle" };

/**
 * Pins for the current viewport (spec §5.2, reconciliations 13–14).
 * Viewport generations invalidate results before debounce; request ownership
 * also guards explicit refreshes. Periodic ticks coalesce with an in-flight
 * request for the current generation and never bypass a pending debounce.
 * A failed box keeps previous pins. Hidden tabs start no new requests.
 */
export function useRoomPins(deps: UseRoomPinsDeps = {}): RoomPins {
  const roomsApi = deps.api ?? defaultApi;
  const intervalMs = deps.intervalMs ?? getClientConfig().pollIntervalMs;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [state, setState] = useState<PinsState>(INITIAL);
  const viewportRef = useRef<Viewport | null>(null);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);
  const activeRef = useRef<RequestOwner | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  const runRefresh = useCallback(
    (explicit: boolean) => {
      if (explicit) clearDebounce();
      const viewport = viewportRef.current;
      if (viewport === null || document.visibilityState !== "visible") return;
      const generation = generationRef.current;
      if (!explicit && (debounceRef.current !== null || activeRef.current?.generation === generation)) {
        return;
      }

      const owner: RequestOwner = { generation, sequence: ++sequenceRef.current };
      activeRef.current = owner;
      const isCurrent = () =>
        owner.generation === generationRef.current &&
        owner.sequence === sequenceRef.current &&
        activeRef.current === owner;
      setState((s) => (s.status === "idle" ? { ...s, status: "loading" } : s));
      Promise.all(toQueryBoxes(viewport).map((box) => roomsApi.rooms.list(box))).then(
        (results) => {
          if (!isCurrent()) return;
          activeRef.current = null;
          setState({ ...mergeBoxResults(results), status: "ready" });
        },
        () => {
          if (!isCurrent()) return;
          activeRef.current = null;
          setState((s) => ({ ...s, status: "error" }));
        },
      );
    },
    [roomsApi, clearDebounce],
  );

  const refresh = useCallback(() => runRefresh(true), [runRefresh]);

  const setViewport = useCallback(
    (viewport: Viewport) => {
      const first = viewportRef.current === null;
      viewportRef.current = viewport;
      generationRef.current += 1;
      clearDebounce();
      if (document.visibilityState !== "visible") return;
      if (first) {
        refresh();
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        refresh();
      }, debounceMs);
    },
    [refresh, debounceMs, clearDebounce],
  );

  const insertRoom = useCallback((room: Room) => {
    setState((s) => ({
      ...s,
      rooms: sortRoomsNewestFirst([room, ...s.rooms.filter((r) => r.id !== room.id)]),
    }));
  }, []);

  // Periodic refresh while visible (PRD 4). `refresh` is only ever called from
  // the timer or the event handler, never synchronously in the effect body.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => runRefresh(false), intervalMs);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
        clearDebounce();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, runRefresh, intervalMs, clearDebounce]);

  // On unmount: drop the pending debounce and make every in-flight response stale.
  useEffect(
    () => () => {
      clearDebounce();
      generationRef.current += 1;
      sequenceRef.current += 1;
      activeRef.current = null;
    },
    [clearDebounce],
  );

  return {
    rooms: state.rooms,
    truncated: state.truncated,
    status: state.status,
    setViewport,
    refresh,
    insertRoom,
  };
}
