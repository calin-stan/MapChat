-- Atomic room creation (PRD 6.3): the room row and its first message are
-- inserted in one function call, so a failure on either leaves nothing behind.
--
-- The function deliberately does NOT catch unique violations. The route
-- handler inspects the violated constraint name on SQLSTATE 23505:
--   chatrooms_name_key     -> generate a new name and retry (up to 5 times)
--   chatrooms_lat_lng_key  -> 409 Conflict with the existing room
-- Coordinates are rounded to 6 decimals by the server before calling this.

create function public.create_room_with_first_message(
  p_lat    double precision,
  p_lng    double precision,
  p_name   text,
  p_author text,
  p_text   text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room    public.chatrooms;
  v_message public.messages;
begin
  insert into public.chatrooms (name, lat, lng)
  values (p_name, p_lat, p_lng)
  returning * into v_room;

  insert into public.messages (chatroom_id, author, text)
  values (v_room.id, p_author, p_text)
  returning * into v_message;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'message', to_jsonb(v_message)
  );
end;
$$;

comment on function public.create_room_with_first_message(double precision, double precision, text, text, text) is
  'Creates a chatroom and its first message atomically. Returns {"room": ..., "message": ...}. Executable by service_role only.';

-- PRD 6.1: no privileged write function may be publicly executable. Supabase's
-- default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role; PUBLIC has EXECUTE on every function by
-- default in Postgres. Revoke all of them, then grant service_role alone.
revoke execute on function public.create_room_with_first_message(double precision, double precision, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_room_with_first_message(double precision, double precision, text, text, text)
  to service_role;
