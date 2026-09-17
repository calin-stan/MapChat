import { type Prefill, type Selection, selectionReducer } from "@/lib/page/selection";
import type { CreateRoomInput } from "@/lib/schemas/room";
import type { Message, Room } from "@/lib/schemas/types";

/** A rejected create: what was submitted and why it failed (new-room design §6). */
export type Recovery = { input: CreateRoomInput; error: unknown };

/**
 * What `MapShell` keeps next to the selection (new-room design §6).
 * `revision` is part of both panel keys: every create outcome increments it,
 * so the panel it opens is a fresh mount even when the same room, or a draft,
 * is already showing. `recovery` is non-null only while the draft it restored
 * is still open.
 */
export type Handoff = { selection: Selection; revision: number; recovery: Recovery | null };

export type HandoffAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "close" }
  | { type: "created"; room: Room; message: Message }
  | { type: "conflict"; room: Room; prefill: Prefill }
  | { type: "failed"; input: CreateRoomInput; error: unknown };

export function initialHandoff(selection: Selection): Handoff {
  return { selection, revision: 0, recovery: null };
}

/**
 * Wraps the pure selection reducer; its transitions and actions are unchanged.
 * Selection, revision and recovery change in one state update, so React never
 * commits a new selection under an old panel key.
 */
export function handoffReducer(state: Handoff, action: HandoffAction): Handoff {
  switch (action.type) {
    case "clickEmpty": {
      // Moving an open draft keeps its form, and with it a recovered error.
      const recovery = state.selection.kind === "draft" ? state.recovery : null;
      return { ...state, selection: selectionReducer(state.selection, action), recovery };
    }
    case "clickPin": {
      const selection = selectionReducer(state.selection, action);
      // The already selected pin: same object, so nothing re-renders or remounts.
      return selection === state.selection ? state : { ...state, selection, recovery: null };
    }
    case "close":
      return { ...state, selection: selectionReducer(state.selection, action), recovery: null };
    case "created":
      return {
        selection: selectionReducer(state.selection, {
          type: "roomCreated",
          room: action.room,
          message: action.message,
        }),
        revision: state.revision + 1,
        recovery: null,
      };
    case "conflict":
      return {
        selection: selectionReducer(state.selection, {
          type: "movedToExisting",
          room: action.room,
          prefill: action.prefill,
        }),
        revision: state.revision + 1,
        recovery: null,
      };
    case "failed":
      return {
        selection: selectionReducer(state.selection, {
          type: "clickEmpty",
          lat: action.input.lat,
          lng: action.input.lng,
        }),
        revision: state.revision + 1,
        recovery: { input: action.input, error: action.error },
      };
  }
}

/** Panel keys (new-room design §6): stable across draft moves, fresh after every outcome. */
export const draftPanelKey = (handoff: Handoff) => `draft:${handoff.revision}`;
export const roomPanelKey = (handoff: Handoff, room: Room) => `${room.id}:${handoff.revision}`;
