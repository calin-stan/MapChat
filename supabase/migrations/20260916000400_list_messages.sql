-- History and cursor pagination for one room (PRD 4 "History", 6.5 "Cursor
-- semantics"). The route handler calls this through PostgREST with the
-- service-role key; doing the tuple comparison here keeps it one query on
-- messages_room_created_idx instead of emulating (created_at, id) < (a, b)
-- with PostgREST filters.
--
--   p_mode = 'initial'  newest p_limit messages, newest first (p_cursor null)
--   p_mode = 'before'   messages with (created_at, id) < cursor, newest first
--   p_mode = 'after'    messages with (created_at, id) > cursor, oldest first
--
-- The caller asks for one row more than it needs to learn whether more exist,
-- and reverses 'initial'/'before' results so every page is oldest first.
--
-- Errors use SQLSTATEs that PostgREST maps to HTTP statuses (PTxyz -> xyz)
-- and that supabase-js exposes as error.code:
--   PT404  room not found
--   PT400  cursor not found in room (unknown id, or a message of another room)
--   22023  argument misuse (invalid_parameter_value); the route never sends these

create function public.list_messages(
  p_room   uuid,
  p_mode   text,
  p_cursor uuid,
  p_limit  integer
)
returns setof public.messages
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be at least 1' using errcode = '22023';
  end if;

  if not exists (select 1 from public.chatrooms c where c.id = p_room) then
    raise exception 'room not found' using errcode = 'PT404';
  end if;

  if p_mode is null or p_mode not in ('initial', 'before', 'after') then
    raise exception 'p_mode must be initial, before or after' using errcode = '22023';
  end if;

  if p_mode = 'initial' then
    if p_cursor is not null then
      raise exception 'p_cursor must be null for mode initial' using errcode = '22023';
    end if;
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
      order by m.created_at desc, m.id desc
      limit p_limit;
    return;
  end if;

  if p_cursor is null then
    raise exception 'p_cursor is required for mode %', p_mode using errcode = '22023';
  end if;

  select m.created_at, m.id into v_cursor_at, v_cursor_id
  from public.messages m
  where m.id = p_cursor and m.chatroom_id = p_room;
  if not found then
    raise exception 'cursor not found in room' using errcode = 'PT400';
  end if;

  if p_mode = 'before' then
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
        and (m.created_at, m.id) < (v_cursor_at, v_cursor_id)
      order by m.created_at desc, m.id desc
      limit p_limit;
  else
    return query
      select m.* from public.messages m
      where m.chatroom_id = p_room
        and (m.created_at, m.id) > (v_cursor_at, v_cursor_id)
      order by m.created_at asc, m.id asc
      limit p_limit;
  end if;
end;
$$;

comment on function public.list_messages(uuid, text, uuid, integer) is
  'History page for a room: mode initial (newest first), before (older than cursor, newest first) or after (newer than cursor, oldest first); cursors compare (created_at, id). Raises PT404 for an unknown room and PT400 for a cursor outside the room. Executable by service_role only.';

-- PRD 6.1: app helper functions are not publicly executable. Anonymous reads
-- of the tables themselves stay allowed through the table grants.
revoke execute on function public.list_messages(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_messages(uuid, text, uuid, integer)
  to service_role;
