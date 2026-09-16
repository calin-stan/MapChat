-- Development data, loaded by `pnpm db:reset` (supabase/config.toml, [db.seed]).
-- Local only: the reset command never runs against a hosted project.
-- Room ids are fixed so messages can reference them. Repeat via `pnpm db:reset`,
-- which recreates the tables; this SQL is not idempotent on populated tables.
-- Every room has at least one message, as the create flow guarantees (PRD 6.3).

insert into public.chatrooms (id, name, lat, lng, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'brave-crimson-otter',  46.771200,  23.623600, now() - interval '5 days'),   -- Cluj-Napoca, Piața Unirii
  ('00000000-0000-4000-8000-000000000002', 'calm-amber-heron',     46.769500,  23.589700, now() - interval '4 days'),   -- Cluj-Napoca, Central Park
  ('00000000-0000-4000-8000-000000000003', 'quiet-teal-badger',    46.780100,  23.601200, now() - interval '3 days'),   -- Cluj-Napoca, Cetățuia
  ('00000000-0000-4000-8000-000000000004', 'witty-violet-lynx',    44.426800,  26.102500, now() - interval '2 days'),   -- Bucharest
  ('00000000-0000-4000-8000-000000000005', 'sunny-coral-puffin',   47.497900,  19.040200, now() - interval '1 day'),    -- Budapest
  ('00000000-0000-4000-8000-000000000006', 'eager-golden-kiwi',   -16.578400, 179.900000, now() - interval '12 hours'), -- Fiji, east of the antimeridian
  ('00000000-0000-4000-8000-000000000007', 'gentle-silver-seal',  -16.600000, -179.900000, now() - interval '6 hours'), -- Fiji, west of the antimeridian
  ('00000000-0000-4000-8000-000000000008', 'bold-ivory-condor',    40.712800, -74.006000, now() - interval '1 hour');   -- New York

insert into public.messages (chatroom_id, author, text, created_at) values
  ('00000000-0000-4000-8000-000000000001', 'ana',    'Anyone around Piața Unirii tonight?',      now() - interval '5 days'),
  ('00000000-0000-4000-8000-000000000001', 'mihai',  'Yes, near the fountain.',                  now() - interval '5 days' + interval '3 minutes'),
  ('00000000-0000-4000-8000-000000000001', 'ana',    'See you there 👋',                          now() - interval '5 days' + interval '4 minutes'),
  ('00000000-0000-4000-8000-000000000002', 'radu',   'The park is great for a run this morning.', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000003', 'ioana',  'Best view of the city from up here.',      now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000004', 'andrei', 'Coffee recommendations near Universitate?', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000005', 'zsófia', 'Thermal baths open late today.',           now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000006', 'sione',  'First room east of the date line!',        now() - interval '12 hours'),
  ('00000000-0000-4000-8000-000000000007', 'mere',   'And the first one west of it.',            now() - interval '6 hours'),
  ('00000000-0000-4000-8000-000000000008', 'sam',    'Hello from downtown.',                     now() - interval '1 hour');

-- 600 rooms in a 30 × 20 grid, about 110 m apart north-south and about 80 m
-- apart east-west, south of Bucharest, so the 500-pin cap and the
-- "Zoom in to see more rooms" pill can be seen locally (PRD 4). Coordinates
-- are computed in numeric so they are exact to 6 decimals.
with grid as (
  select
    gx,
    gy,
    ('00000000-0000-4000-8000-' || lpad(to_hex(1000 + gx * 100 + gy), 12, '0'))::uuid as id
  from generate_series(0, 29) as gx, generate_series(0, 19) as gy
),
grid_rooms as (
  insert into public.chatrooms (id, name, lat, lng, created_at)
  select
    id,
    format('grid-%s-%s', gx, gy),
    (44.300 + gy * 0.001)::double precision,
    (26.000 + gx * 0.001)::double precision,
    now() - (gx * 20 + gy) * interval '1 minute'
  from grid
  returning id, created_at
)
insert into public.messages (chatroom_id, author, text, created_at)
select id, 'seed', 'Hello from the grid.', created_at
from grid_rooms;
