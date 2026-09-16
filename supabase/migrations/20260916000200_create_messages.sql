-- Messages: posts inside a chatroom (PRD 6.2). Length limits count Unicode
-- code points with char_length(), matching [...s].length in JavaScript (PRD 4).

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  chatroom_id  uuid not null,
  author       text not null,
  text         text not null,
  created_at   timestamptz not null default now(),
  constraint messages_chatroom_id_fkey
    foreign key (chatroom_id) references public.chatrooms (id) on delete cascade,
  constraint messages_author_check check (char_length(author) between 1 and 100),
  constraint messages_text_check check (char_length(text) between 1 and 3000)
);

comment on table public.messages is
  'Messages in a chatroom. Ordered by (created_at, id); the id breaks ties for cursor pagination (PRD 6.5).';

-- Serves initial history, "before" pages and "after" catch-up, all of which
-- filter by chatroom_id and order by (created_at, id) (PRD 6.5).
create index messages_room_created_idx
  on public.messages (chatroom_id, created_at desc, id desc);

-- Row Level Security (PRD 6.1): anonymous visitors may read, never write.
-- Realtime evaluates this policy for anon subscribers of Postgres Changes.
alter table public.messages enable row level security;

create policy "messages are publicly readable"
  on public.messages
  for select
  to anon
  using (true);

revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to anon;
grant all on table public.messages to service_role;

-- Realtime (PRD 6.4): Postgres Changes fan out INSERTs on messages. Supabase
-- ships the supabase_realtime publication with no tables; create it only if
-- an environment is missing it, then add messages. chatrooms is deliberately
-- not published (pins are fetched over HTTP).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.messages;
