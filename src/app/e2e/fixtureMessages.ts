import type { Message } from "@/lib/schemas/types";

export const FIXTURE_ROOM_ID = "11111111-1111-4111-8111-111111111111";

/** Message `n`; every third one has three lines, so row heights differ like real chat. */
export function fixtureMessage(n: number): Message {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    chatroomId: FIXTURE_ROOM_ID,
    author: `author-${n}`,
    text: n % 3 === 0 ? `fixture message ${n}\nsecond line\nthird line` : `fixture message ${n}`,
    createdAt: `2026-09-16T10:00:00.${String(n).padStart(6, "0")}Z`,
  };
}

export function fixtureRange(from: number, to: number): Message[] {
  return Array.from({ length: to - from + 1 }, (_, index) => fixtureMessage(from + index));
}
