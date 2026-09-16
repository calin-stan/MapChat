import type { Sql } from "./helpers";

/** A `public.messages` row as postgres.js returns it (timestamptz becomes a Date). */
export interface DbMessageRow {
  id: string;
  chatroom_id: string;
  author: string;
  text: string;
  created_at: Date;
}

/** A room at random coordinates; message tests only need it to exist. */
export async function insertRoom(sql: Sql, name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.chatrooms (name, lat, lng)
    values (
      ${name},
      ${Math.random() * 180 - 90}::double precision,
      ${Math.random() * 360 - 180}::double precision
    )
    returning id`;
  return row.id;
}

/** One message with an explicit creation time, for ordering and tie cases. */
export async function insertMessageAt(
  sql: Sql,
  roomId: string,
  text: string,
  createdAt: string,
  author = "ann",
): Promise<DbMessageRow> {
  // Bind as text (OID 25): postgres.js's default timestamptz serializer
  // round-trips a bound value through `new Date(x).toISOString()`, which caps
  // at millisecond precision regardless of the `::timestamptz` cast. Binding
  // as text skips that serializer, so Postgres's own cast keeps microseconds.
  const [row] = await sql<DbMessageRow[]>`
    insert into public.messages (chatroom_id, author, text, created_at)
    values (${roomId}::uuid, ${author}, ${text}, ${sql.typed(createdAt, 25)}::timestamptz)
    returning id, chatroom_id, author, text, created_at`;
  return row;
}

/**
 * `count` messages "m1".."m<count>" by "ann", one millisecond apart from
 * `startAt`, returned oldest first. One statement, so 250 rows are quick.
 */
export async function insertMessageSeries(
  sql: Sql,
  roomId: string,
  count: number,
  startAt = "2026-09-16T10:00:00Z",
): Promise<DbMessageRow[]> {
  const rows = await sql<DbMessageRow[]>`
    insert into public.messages (chatroom_id, author, text, created_at)
    select
      ${roomId}::uuid,
      'ann',
      'm' || g,
      ${startAt}::timestamptz + (g * interval '1 millisecond')
    from generate_series(1, ${count}::integer) g
    returning id, chatroom_id, author, text, created_at`;
  return [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}
