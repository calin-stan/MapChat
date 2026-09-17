import type { Message, Room } from "@/lib/schemas/types";

/** Text chunk 10 carries into the room panel when a create lands on an existing room. */
export type Prefill = { author: string; text: string };

/** What the map page shows in its panel (spec §6). */
export type Selection =
  | { kind: "none"; gone?: Room } // `gone`: the room whose panel was just closed because it no longer exists
  | { kind: "draft"; lat: number; lng: number }
  | { kind: "room"; room: Room; prefill?: Prefill; seed?: Message };

export type SelectionAction =
  | { type: "clickEmpty"; lat: number; lng: number }
  | { type: "clickPin"; room: Room }
  | { type: "roomCreated"; room: Room; message: Message } // message becomes the seed
  | { type: "movedToExisting"; room: Room; prefill: Prefill }
  | { type: "roomGone"; roomId: string } // the open room answered 404 (chunk 12)
  | { type: "close" };

/**
 * Pure transition table (spec §6). `clickPin` on the already selected room
 * returns the same object so the keyed room panel is not remounted and its
 * prefill and seed survive. Only `roomCreated` sets a seed: the first message
 * of a room this visitor just created (room-panel design §3.1). `roomGone`
 * closes the panel of the room it names and remembers that room for the
 * page-level notice; for any other state it returns the same object, so a late
 * report about a room that is no longer open changes nothing. Every other
 * action builds a fresh selection, which is what clears the notice.
 */
export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "clickEmpty":
      return { kind: "draft", lat: action.lat, lng: action.lng };
    case "clickPin":
      return state.kind === "room" && state.room.id === action.room.id
        ? state
        : { kind: "room", room: action.room };
    case "roomCreated":
      return { kind: "room", room: action.room, seed: action.message };
    case "movedToExisting":
      return { kind: "room", room: action.room, prefill: action.prefill };
    case "roomGone":
      return state.kind === "room" && state.room.id === action.roomId
        ? { kind: "none", gone: state.room }
        : state;
    case "close":
      return { kind: "none" };
  }
}
