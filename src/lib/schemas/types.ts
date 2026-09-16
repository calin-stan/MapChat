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
