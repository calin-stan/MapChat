/**
 * API data transfer objects shared by route handlers and the UI (chunk spec
 * §0.2). Field names are camelCase; route handlers map database rows to these.
 * `createdAt` is an ISO-8601 UTC string, e.g. "2026-09-16T15:00:00.123Z".
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
