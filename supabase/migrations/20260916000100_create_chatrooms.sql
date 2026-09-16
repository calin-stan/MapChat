-- Chatrooms: one row per map pin (PRD 6.2).
-- Constraint names are part of the API contract: the route handlers tell a
-- name collision (chatrooms_name_key -> regenerate the name) from a coordinate
-- collision (chatrooms_lat_lng_key -> 409 with the existing room). Both are
-- SQLSTATE 23505, so the name is what distinguishes them (PRD 6.3).

create table public.chatrooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now(),
  constraint chatrooms_name_key unique (name),
  constraint chatrooms_lat_lng_key unique (lat, lng),
  constraint chatrooms_lat_check check (lat between -90 and 90),
  constraint chatrooms_lng_check check (lng between -180 and 180)
);

comment on table public.chatrooms is
  'One row per map pin. Created together with its first message by create_room_with_first_message(). Coordinates are rounded to 6 decimals by the server before insert.';

-- Row Level Security (PRD 6.1): anonymous visitors may read, never write.
alter table public.chatrooms enable row level security;

create policy "chatrooms are publicly readable"
  on public.chatrooms
  for select
  to anon
  using (true);

-- Supabase's default privileges grant anon and authenticated ALL on new tables
-- in public. Take that back: anon gets SELECT only (needed for reads and for
-- realtime RLS checks), authenticated gets nothing (no signed-in users), and
-- service_role keeps everything for the route handlers.
revoke all on table public.chatrooms from anon, authenticated;
grant select on table public.chatrooms to anon;
grant all on table public.chatrooms to service_role;
