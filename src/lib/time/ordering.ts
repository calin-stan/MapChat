import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const PARTS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

/** Canonical UTC, six fractional digits. Fractions never pass through Date. */
export function normalizeCreatedAt(value: string): string {
  const parts = PARTS.exec(value);
  if (!parts || !timestamp.safeParse(value).success) {
    throw new RangeError("Expected an ISO timestamp with at most six fractional digits");
  }
  const wholeSecond = new Date(`${parts[1]}${parts[3]}`).toISOString();
  if (wholeSecond.length !== 24) throw new RangeError("UTC year must have four digits");
  return `${wholeSecond.slice(0, 19)}.${(parts[2] ?? "").padEnd(6, "0")}Z`;
}

/** Ascending SQL tuple order; inputs use canonical timestamps and lowercase UUIDs. */
export function compareCreatedAtId(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}
