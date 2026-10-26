-- 1. Sales can no longer add homes.
-- 2. A community can only move to another builder while it has no homes.
-- 3. Media library: one record per photo, video or floor plan, organized by
--    builder > community > home, with a room label, tags and search text.
--    Files live in a private storage bucket; access follows the same rules
--    as homes (staff see all, builders see theirs, sales see their communities).

-- ---------------------------------------------------------------------------
-- 1. Sales can't add homes
-- ---------------------------------------------------------------------------
alter policy "builder editors add homes" on public.homes
  with check (private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager')
        and private.can_see_home(builder_id, community_id)
        and workflow_status = 'draft'
        and mls_number is null
        and deleted_at is null));

-- ---------------------------------------------------------------------------
-- 2. Community builder changes
-- ---------------------------------------------------------------------------
create or replace function public.enforce_community_builder_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.builder_id is distinct from old.builder_id
     and exists (select 1 from public.homes h where h.community_id = new.id) then
    raise exception 'This community already has homes, so it can''t move to another builder' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_community_builder_change() from public, anon, authenticated;
create trigger communities_builder_change
  before update of builder_id on public.communities
  for each row execute function public.enforce_community_builder_change();

-- Only our admins move a community between builders.
create or replace function public.enforce_community_owner_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and private.my_role() <> 'platform_admin'
     and new.builder_id is distinct from old.builder_id then
    raise exception 'Only our admins can move a community to another builder' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_community_owner_rules() from public, anon, authenticated;
create trigger communities_owner_rules
  before update on public.communities
  for each row execute function public.enforce_community_owner_rules();

-- ---------------------------------------------------------------------------
-- 3. Media
-- ---------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  community_id uuid references public.communities (id),
  home_id uuid references public.homes (id),
  kind text not null check (kind in ('photo', 'video', 'floor_plan')),
  room text check (room in (
    'exterior', 'kitchen', 'living', 'dining', 'primary_bedroom', 'bedroom',
    'primary_bath', 'bath', 'backyard', 'floor_plan', 'amenity', 'entrance',
    'aerial', 'site_map', 'model_home', 'other')),
  title text not null,
  caption text,
  tags text[] not null default '{}',
  search_text text not null default '',
  source text not null check (source in ('demo', 'upload')),
  storage_path text unique,        -- for uploads: builder/community/home/file
  demo_key text,                   -- for generated test media
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric(8, 2),
  is_cover boolean not null default false,
  mls_ready boolean not null default false,
  sort_order integer not null default 0,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,          -- 30-day trash
  constraint media_has_file check (
    (source = 'upload' and storage_path is not null) or (source = 'demo' and demo_key is not null))
);
create index media_builder_idx on public.media (builder_id) where deleted_at is null;
create index media_community_idx on public.media (community_id) where deleted_at is null;
create index media_home_idx on public.media (home_id, sort_order) where deleted_at is null;
create index media_tags_idx on public.media using gin (tags);

-- Fill in builder/community from the home, add automatic tags, and build the
-- search text (title, room, tags, address, plan, community).
create or replace function public.media_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h record;
  c record;
  auto text[] := '{}';
begin
  if new.home_id is not null then
    select id, builder_id, community_id, unparsed_address, plan_name into h from public.homes where id = new.home_id;
    if h.id is null then raise exception 'Unknown home'; end if;
    new.builder_id := h.builder_id;
    new.community_id := h.community_id;
    auto := auto || array_remove(array[h.unparsed_address, case when h.plan_name is not null then h.plan_name || ' plan' end], null);
  end if;
  if new.community_id is not null then
    select id, builder_id, name into c from public.communities where id = new.community_id;
    if c.id is null then raise exception 'Unknown community'; end if;
    if new.builder_id is distinct from c.builder_id then
      if tg_op = 'INSERT' and new.home_id is null then new.builder_id := c.builder_id;
      else raise exception 'That community belongs to a different builder'; end if;
    end if;
    auto := auto || c.name;
  end if;
  if new.room is not null then
    auto := auto || replace(replace(replace(new.room, 'primary_', 'primary '), '_', ' '), 'living', 'living room');
  end if;

  -- Keep tags tidy: trimmed, no blanks, no duplicates (case-insensitive).
  select coalesce(array_agg(t order by min_ord), '{}') into new.tags from (
    select min(ord) as min_ord, (array_agg(trim(t) order by ord))[1] as t
    from unnest(new.tags || auto) with ordinality as u(t, ord)
    where trim(t) <> ''
    group by lower(trim(t))
  ) x;

  new.search_text := lower(concat_ws(' ', new.title, new.caption, new.room, array_to_string(new.tags, ' ')));
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  end if;
  return new;
end $$;
revoke execute on function public.media_prepare() from public, anon, authenticated;
create trigger media_prepare
  before insert or update on public.media
  for each row execute function public.media_prepare();

-- Log media changes on the home's activity history.
create or replace function public.media_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.home_id is null or auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    perform private.log_activity(new.home_id, 'media_added', jsonb_build_object('title', new.title, 'kind', new.kind));
  elsif new.deleted_at is not null and old.deleted_at is null then
    perform private.log_activity(new.home_id, 'media_trashed', jsonb_build_object('title', new.title));
  elsif new.deleted_at is null and old.deleted_at is not null then
    perform private.log_activity(new.home_id, 'media_restored', jsonb_build_object('title', new.title));
  end if;
  return new;
end $$;
revoke execute on function public.media_log() from public, anon, authenticated;
create trigger media_log
  after insert or update on public.media
  for each row execute function public.media_log();

-- Who can see a media item: staff all; builder users their builder; sales only
-- their communities (plus builder-wide items with no community).
create or replace function private.can_see_media(b uuid, c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b = private.my_builder_id()
          and (private.my_role() <> 'sales' or c is null or c in (select private.my_community_ids())))
$$;
-- Who can add or change media: our admins, and builder owners, managers and marketing.
create or replace function private.can_manage_media(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'platform_admin'
      or (b = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing'))
$$;
revoke execute on function private.can_see_media(uuid, uuid), private.can_manage_media(uuid) from public, anon;
grant execute on function private.can_see_media(uuid, uuid), private.can_manage_media(uuid) to authenticated;

alter table public.media enable row level security;
revoke all on public.media from anon;

create policy "see visible media" on public.media
  for select to authenticated using (private.can_see_media(builder_id, community_id));
create policy "media managers add" on public.media
  for insert to authenticated with check (private.can_manage_media(builder_id));
create policy "media managers edit" on public.media
  for update to authenticated
  using (private.can_manage_media(builder_id))
  with check (private.can_manage_media(builder_id));
-- No delete policy: media goes to the trash (deleted_at) instead.

-- ---------------------------------------------------------------------------
-- Private file storage for uploads. Files are never public; the app hands out
-- links that expire. Paths start with the builder's ID.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/svg+xml', 'video/mp4', 'video/quicktime', 'application/pdf'])
on conflict (id) do nothing;

create policy "media files: see if you can see the record" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and exists (select 1 from public.media m where m.storage_path = storage.objects.name));

create policy "media files: upload into your builder's folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (private.my_role() = 'platform_admin'
         or (private.my_role() in ('builder_owner', 'manager', 'marketing')
             and (storage.foldername(name))[1] = private.my_builder_id()::text)));
