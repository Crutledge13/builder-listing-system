-- Floor plans with their room list, and room sizes on each home.
--
-- NTREIS's form has a room list: each row is a room type, level, length and
-- width (feet), and features. Our team sets up each builder's floor plans once
-- (specs plus the room list; the plan PDF can be read by AI to save typing).
-- A home then pulls its rooms from its plan, and builders can adjust them.
-- A home's rooms live in homes.mls_fields -> 'Rooms' (RESO Rooms: RoomType,
-- RoomLevel, RoomLength, RoomWidth, RoomFeatures), next to its other NTREIS answers.

create table public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  name text not null check (length(trim(name)) between 1 and 80),
  bedrooms_total int check (bedrooms_total between 0 and 20),
  bathrooms_full int check (bathrooms_full between 0 and 20),
  bathrooms_half int check (bathrooms_half between 0 and 20),
  living_area int check (living_area > 0),
  stories int check (stories between 1 and 5),
  garage_spaces int check (garage_spaces between 0 and 10),
  levels text,
  living_areas_total int check (living_areas_total between 0 and 20),
  dining_areas_total int check (dining_areas_total between 0 and 20),
  rooms jsonb not null default '[]' check (jsonb_typeof(rooms) = 'array' and jsonb_array_length(rooms) <= 60),
  notes text check (length(notes) <= 2000),
  plan_file_path text,
  plan_file_name text check (length(plan_file_name) <= 200),
  scan jsonb,               -- what AI read off the plan file, until someone uses or dismisses it
  scanned_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create unique index floor_plans_name on public.floor_plans (builder_id, lower(name));

alter table public.floor_plans enable row level security;
-- Everyone at the builder can see its plans (to pull rooms into homes); our staff see all.
create policy "see floor plans" on public.floor_plans for select to authenticated
  using (private.is_staff() or private.can_see_builder(builder_id));
-- Our team sets plans up (the initial upload happens on our side).
create policy "our team adds floor plans" on public.floor_plans for insert to authenticated with check (private.is_staff());
create policy "our team changes floor plans" on public.floor_plans for update to authenticated using (private.is_staff()) with check (private.is_staff());

-- Keep room rows well-formed: a known NTREIS room type, level 1-9 or B, sizes in feet.
create or replace function private.clean_rooms(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb; out jsonb := '[]';
  types text[] := array['Basement','Bath-Full','Bath-Half','Bath-Primary','Bedroom','Bedroom-2nd Primary','Bedroom-Primary','Bonus Room',
    'Breakfast Rm','Den','Dining Room','Exercise Room','Extra Strg Rm','Family Room','Game Room','Great Room','Guest Suite','Gym','Kitchen',
    'Laundry','Library','Living Room','Loft','Media Room','Mud Room','Music Room','Office','Sauna','Solarium/Sunrm','Spa/HotTub Rm',
    'Utility Room','Wine Cellar','Workshop'];
  len numeric; wid numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'; end if;
  for r in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(r) <> 'object' or not (r ->> 'RoomType' = any(types)) then continue; end if;
    len := case when (r ->> 'RoomLength') ~ '^\d+(\.\d+)?$' then (r ->> 'RoomLength')::numeric end;
    wid := case when (r ->> 'RoomWidth') ~ '^\d+(\.\d+)?$' then (r ->> 'RoomWidth')::numeric end;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'RoomType', r ->> 'RoomType',
      'RoomLevel', case when (r ->> 'RoomLevel') ~ '^[1-9B]$' then r ->> 'RoomLevel' end,
      'RoomLength', case when len between 1 and 200 then round(len, 1) end,
      'RoomWidth', case when wid between 1 and 200 then round(wid, 1) end,
      'RoomFeatures', case when jsonb_typeof(r -> 'RoomFeatures') = 'array' then r -> 'RoomFeatures' end
    )));
  end loop;
  return out;
end $$;

create or replace function public.floor_plans_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := trim(new.name);
  new.rooms := private.clean_rooms(new.rooms);
  if new.plan_file_path is not null and split_part(new.plan_file_path, '/', 1) <> new.builder_id::text then
    raise exception 'The plan file must be in this builder''s folder';
  end if;
  if tg_op = 'UPDATE' then
    new.builder_id := old.builder_id;
    if new.plan_file_path is distinct from old.plan_file_path then new.scan := null; new.scanned_at := null; end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.floor_plans_prepare() from public, anon, authenticated;
create trigger floor_plans_prepare before insert or update on public.floor_plans
  for each row execute function public.floor_plans_prepare();

-- A home's room list is cleaned the same way whenever its NTREIS answers are saved.
create or replace function public.homes_clean_rooms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mls_fields ? 'Rooms' and (tg_op = 'INSERT' or new.mls_fields -> 'Rooms' is distinct from old.mls_fields -> 'Rooms') then
    new.mls_fields := jsonb_set(new.mls_fields, '{Rooms}', private.clean_rooms(new.mls_fields -> 'Rooms'));
  end if;
  return new;
end $$;
revoke all on function public.homes_clean_rooms() from public, anon, authenticated;
create trigger homes_clean_rooms before insert or update of mls_fields on public.homes
  for each row execute function public.homes_clean_rooms();

-- Plan files (PDF or image), private, our team uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('plan-files', 'plan-files', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "plan files: our team uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'plan-files' and private.is_staff());
create policy "plan files: see if you can see the plan" on storage.objects
  for select to authenticated using (bucket_id = 'plan-files' and exists (select 1 from public.floor_plans f where f.plan_file_path = objects.name));

-- Readiness: NTREIS homes with no room sizes get a reminder (a warning, not a block).
do $$ declare d text; begin
  d := pg_get_functiondef('public.mls_readiness'::regproc);
  d := replace(d, $x$  select count(*) into team_missing from ($x$,
    $x$  if b.code = 'NTREIS' and coalesce(jsonb_array_length(h.mls_fields -> 'Rooms'), 0) = 0 then
    out := out || jsonb_build_object('level', 'warn', 'code', 'rooms',
      'message', 'Add room sizes (each room''s level, length and width). Pull them from the floor plan under Room sizes on the home.');
  end if;

  select count(*) into team_missing from ($x$);
  if position('Add room sizes' in d) = 0 then raise exception 'mls_readiness: pattern not found'; end if;
  execute d;
end $$;
