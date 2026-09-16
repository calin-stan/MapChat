/**
 * API data transfer objects shared by route handlers and the UI (chunk spec
 * §0.2). Field names are camelCase; route handlers map database rows to these.
 * `createdAt` is canonical ISO-8601 UTC with exactly six fractional digits, e.g.
 * "2026-09-16T15:00:00.123456Z". Use compareCreatedAtId for ordering; Date for display only.
 */

export type Room = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  createdAt: string;
};

export type Message = {
  id: string;
  chatroomId: string;
  author: string;
  text: string;
  createdAt: string;
};

/**
 * One page of a room's history (PRD 6.5): `GET /api/rooms/:id/messages` with
 * no cursor or `?before=`. Messages are ascending, oldest first. `hasMore`
 * tells whether an older page exists (it describes the query's snapshot).
 */
export type MessagePage = {
  messages: Message[];
  hasMore: boolean;
};

/**
 * A catch-up page (`?after=`, PRD 6.4): ascending, at most 100 messages.
 * `nextCursor` is the last returned id, or the requested cursor when the page
 * is empty; the client stores it as its synchronization bookmark.
 */
export type CatchUpPage = MessagePage & {
  nextCursor: string;
};
