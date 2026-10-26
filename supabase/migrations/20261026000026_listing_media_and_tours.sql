-- What goes on each MLS listing: photos, floor plans, video and virtual tours,
-- in order.
--
-- virtual_tours: links to 3D and video tours (Matterport, Zillow 3D Home,
--   iGUIDE, Cupix, YouTube, Vimeo, other) for a home or a whole community.
-- listing_media: the ordered list of items on one home's listing. It fills
--   itself: anything uploaded or linked to the home (by our photographer or by
--   the builder) is added at the end. Community and floor-plan items are
--   optional; the builder adds the ones they want. Removing an item from the
--   listing doesn't delete the photo; trashing a photo takes it off every listing.

-- ---------------------------------------------------------------------------
-- 1. Virtual tours
-- ---------------------------------------------------------------------------
create table public.virtual_tours (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  community_id uuid not null references public.communities (id),
  home_id uuid references public.homes (id),           -- null = the whole community (e.g. model home tour)
  provider text not null check (provider in ('matterport', 'zillow_3d', 'iguide', 'cupix', 'youtube', 'vimeo', 'other')),
  url text not null check (url ~* '^https://[^[:space:]]+$' and length(url) <= 1000),
  branded boolean not null default false,              -- MLSs generally want the unbranded link
  title text check (length(title) <= 120),
  added_by uuid references auth.users (id),
  added_by_role text,                                  -- photographer / builder / staff, for the source rule
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                               -- 30-day trash
);
create index virtual_tours_home_idx on public.virtual_tours (home_id) where deleted_at is null;
create index virtual_tours_community_idx on public.virtual_tours (community_id) where deleted_at is null;

-- Fill in the builder and community from the home (or the builder from the
-- community), and who added it.
create or replace function public.virtual_tours_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r text := private.my_role();
begin
  if new.home_id is not null then
    select h.builder_id, h.community_id into new.builder_id, new.community_id from public.homes h where h.id = new.home_id;
  elsif new.community_id is not null then
    select c.builder_id into new.builder_id from public.communities c where c.id = new.community_id;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    new.added_by_role := case when r = 'photographer' then 'photographer'
                              when r in ('platform_admin', 'listing_coordinator') then 'staff'
                              when r is null then null else 'builder' end;
  else
    new.added_by := old.added_by;
    new.added_by_role := old.added_by_role;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.virtual_tours_prepare() from public, anon, authenticated;
create trigger virtual_tours_prepare before insert or update on public.virtual_tours
  for each row execute function public.virtual_tours_prepare();

alter table public.virtual_tours enable row level security;
revoke all on public.virtual_tours from anon;

-- Same people as media: who can see the community's media sees its tours;
-- photographers see and add tours only for their open jobs.
create policy "see visible tours" on public.virtual_tours for select to authenticated using (
  private.can_see_media(builder_id, community_id)
  or (private.my_role() = 'photographer'
      and (added_by = auth.uid()
           or home_id in (select private.my_open_job_homes())
           or (home_id is null and community_id in (select private.my_open_job_communities())))));
create policy "media managers and job photographers add tours" on public.virtual_tours for insert to authenticated
  with check (private.can_manage_media(builder_id) or private.photographer_can_shoot(community_id, home_id));
create policy "media managers and the photographer who added it edit tours" on public.virtual_tours for update to authenticated
  using (private.can_manage_media(builder_id) or (added_by = auth.uid() and private.photographer_can_shoot(community_id, home_id)))
  with check (private.can_manage_media(builder_id) or (added_by = auth.uid() and private.photographer_can_shoot(community_id, home_id)));
-- No delete policy: tours go to the trash (deleted_at) instead.

-- ---------------------------------------------------------------------------
-- 2. The listing: which items, in what order
-- ---------------------------------------------------------------------------
create table public.listing_media (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id) on delete cascade,
  media_id uuid references public.media (id) on delete cascade,
  tour_id uuid references public.virtual_tours (id) on delete cascade,
  position integer not null default 0,
  added_by uuid references auth.users (id),
  added_at timestamptz not null default now(),
  constraint listing_media_one_item check ((media_id is null) <> (tour_id is null)),
  constraint listing_media_unique_media unique (home_id, media_id),
  constraint listing_media_unique_tour unique (home_id, tour_id)
);
create index listing_media_home_idx on public.listing_media (home_id, position);
create index listing_media_media_idx on public.listing_media (media_id);
create index listing_media_tour_idx on public.listing_media (tour_id);

-- Only the home's own items, its community's, or its floor plan's (same
-- builder), and nothing in the trash. New items go at the end.
create or replace function public.listing_media_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h public.homes; ok boolean;
begin
  select * into h from public.homes where id = new.home_id;
  if new.media_id is not null then
    select exists (
      select 1 from public.media m
      where m.id = new.media_id and m.deleted_at is null and m.builder_id = h.builder_id
        and m.kind in ('photo', 'floor_plan', 'video')
        and (m.home_id = h.id
             or (m.home_id is null and m.community_id = h.community_id)
             or (m.home_id is null and m.community_id is null and m.plan_name is not null and m.plan_name = h.plan_name))) into ok;
  else
    select exists (
      select 1 from public.virtual_tours t
      where t.id = new.tour_id and t.deleted_at is null and t.builder_id = h.builder_id
        and (t.home_id = h.id or (t.home_id is null and t.community_id = h.community_id))) into ok;
  end if;
  if not ok then
    raise exception 'That item doesn''t belong to this home, its community or its floor plan' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    new.added_at := now();
    if new.position = 0 then
      select coalesce(max(position), 0) + 1 into new.position from public.listing_media where home_id = new.home_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.listing_media_prepare() from public, anon, authenticated;
create trigger listing_media_prepare before insert or update of home_id, media_id, tour_id on public.listing_media
  for each row execute function public.listing_media_prepare();

alter table public.listing_media enable row level security;
revoke all on public.listing_media from anon;

-- Anyone who can see the home sees its listing; the people who manage the
-- builder's media (owners, managers, marketing, our admins) change it.
create policy "see listings of visible homes" on public.listing_media for select to authenticated
  using (exists (select 1 from public.homes h where h.id = listing_media.home_id));
create policy "media managers add to listings" on public.listing_media for insert to authenticated
  with check (exists (select 1 from public.homes h where h.id = listing_media.home_id and private.can_manage_media(h.builder_id)));
create policy "media managers reorder listings" on public.listing_media for update to authenticated
  using (exists (select 1 from public.homes h where h.id = listing_media.home_id and private.can_manage_media(h.builder_id)))
  with check (exists (select 1 from public.homes h where h.id = listing_media.home_id and private.can_manage_media(h.builder_id)));
create policy "media managers take items off listings" on public.listing_media for delete to authenticated
  using (exists (select 1 from public.homes h where h.id = listing_media.home_id and private.can_manage_media(h.builder_id)));

-- ---------------------------------------------------------------------------
-- 3. Fill listings automatically
-- ---------------------------------------------------------------------------
-- Uploaded to a home (by our photographer or the builder): on its listing.
-- Trashed: off every listing. Restored to a home: back on its listing.
create or replace function public.media_to_listing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind not in ('photo', 'floor_plan', 'video') then return new; end if;
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
    delete from public.listing_media where media_id = new.id;
  elsif new.deleted_at is null and new.home_id is not null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    insert into public.listing_media (home_id, media_id) values (new.home_id, new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.media_to_listing() from public, anon, authenticated;

create or replace function public.tours_to_listing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
    delete from public.listing_media where tour_id = new.id;
  elsif new.deleted_at is null and new.home_id is not null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    insert into public.listing_media (home_id, tour_id) values (new.home_id, new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.tours_to_listing() from public, anon, authenticated;
create trigger tours_to_listing after insert or update of deleted_at on public.virtual_tours
  for each row execute function public.tours_to_listing();

-- Everything already uploaded to a home goes on its listing, cover photo first.
insert into public.listing_media (home_id, media_id, position)
select home_id, id, row_number() over (partition by home_id order by is_cover desc, kind = 'video', sort_order, created_at)
from public.media
where home_id is not null and deleted_at is null and kind in ('photo', 'floor_plan', 'video')
on conflict do nothing;

create trigger media_to_listing after insert or update of deleted_at on public.media
  for each row execute function public.media_to_listing();

-- ---------------------------------------------------------------------------
-- 4. Activity log and MLS updates come from the listing now
-- ---------------------------------------------------------------------------
-- Photos on a live listing: added/removed (same format the work sheet
-- already shows). Video, tours and a new photo order: one line each.
create or replace function public.listing_media_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.listing_media := case when tg_op = 'DELETE' then old else new end;
  m public.media;
  t public.virtual_tours;
  live boolean;
  addr text;
  tid uuid;
  tchanges jsonb;
  added jsonb;
  removed jsonb;
  on_list boolean := tg_op <> 'DELETE';
  label text;
begin
  select workflow_status = 'live_on_mls', unparsed_address into live, addr from public.homes where id = r.home_id;
  if r.media_id is not null then select * into m from public.media where id = r.media_id; end if;
  if r.tour_id is not null then select * into t from public.virtual_tours where id = r.tour_id; end if;
  label := coalesce(m.title, t.title, initcap(replace(t.provider, '_', ' ')) || ' tour', 'Item');

  if tg_op = 'UPDATE' then
    -- Only the order changed.
    if live and new.position is distinct from old.position then
      perform private.note_mls_change(r.home_id, 'photo_order', 'Photo order', '"Previous order"'::jsonb, '"New order: see photos in MLS order"'::jsonb);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' or exists (select 1 from public.homes where id = r.home_id) then
    perform private.log_activity(r.home_id, case when on_list then 'listing_media_added' else 'listing_media_removed' end,
      jsonb_build_object('title', label));
  end if;
  if not coalesce(live, false) then return r; end if;

  if m.id is not null and m.kind in ('photo', 'floor_plan') then
    select id, changes into tid, tchanges from public.tasks
    where source_table = 'homes' and source_id = r.home_id and kind = 'mls_update' and status in ('todo', 'in_progress')
    order by created_at desc limit 1;
    if tid is null then
      tid := private.add_task('mls_update', 'Update the MLS for ' || addr, 'Changed in Builder Listings. The work sheet lists each change.',
        r.home_id, null, null, 'homes', r.home_id, now() + interval '1 day', 'normal');
      tchanges := '{}';
    end if;
    added := coalesce(tchanges -> 'photos' -> 'added', '[]');
    removed := coalesce(tchanges -> 'photos' -> 'removed', '[]');
    if on_list then
      if removed @> jsonb_build_array(m.id::text) then
        removed := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(removed) x where x <> to_jsonb(m.id::text));
      else added := added || jsonb_build_array(m.id::text); end if;
    else
      if added @> jsonb_build_array(m.id::text) then
        added := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(added) x where x <> to_jsonb(m.id::text));
      else removed := removed || jsonb_build_array(m.id::text); end if;
    end if;
    update public.tasks set
      changes = case when jsonb_array_length(added) + jsonb_array_length(removed) = 0 then changes - 'photos'
        else changes || jsonb_build_object('photos', jsonb_build_object('label', 'Photos', 'added', added, 'removed', removed)) end,
      checked = array_remove(checked, 'photos'), updated_at = now()
    where id = tid;
  elsif m.id is not null then
    perform private.note_mls_change(r.home_id, 'video:' || m.id, 'Video: ' || m.title,
      case when on_list then 'null'::jsonb else to_jsonb(m.title) end, case when on_list then to_jsonb(m.title) else 'null'::jsonb end);
  elsif t.id is not null then
    perform private.note_mls_change(r.home_id, 'tour:' || t.id, label || case when t.branded then ' (branded)' else ' (unbranded)' end,
      case when on_list then 'null'::jsonb else to_jsonb(t.url) end, case when on_list then to_jsonb(t.url) else 'null'::jsonb end);
  end if;
  return r;
end $$;
revoke execute on function public.listing_media_changes() from public, anon, authenticated;
create trigger listing_media_changes after insert or delete or update of position on public.listing_media
  for each row execute function public.listing_media_changes();

-- The old photo trigger tracked uploads to the home directly; the listing does it now.
drop trigger if exists media_mls_changes on public.media;

-- ---------------------------------------------------------------------------
-- 5. Readiness counts the photos on the listing (including community and plan
--    photos the builder added), and AI warnings only for photos on it.
-- ---------------------------------------------------------------------------
do $do$
declare src text; pat text;
begin
  src := pg_get_functiondef('public.mls_readiness(uuid)'::regprocedure);

  pat := $x$  from public.media where home_id = p_home and kind = 'photo' and deleted_at is null and mls_ready;$x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: photo count not found'; end if;
  src := replace(src, pat, $x$  from public.media where id in (select lm.media_id from public.listing_media lm where lm.home_id = p_home)
    and kind = 'photo' and deleted_at is null and mls_ready;$x$);

  pat := $x$      and kind = 'photo' and deleted_at is null and mls_ready;
  end if;$x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: plan photo count not found'; end if;
  src := replace(src, pat, $x$      and kind = 'photo' and deleted_at is null and mls_ready
      and id not in (select lm.media_id from public.listing_media lm where lm.home_id = p_home and lm.media_id is not null);
  end if;$x$);

  pat := $x$where home_id = p_home and kind = 'photo' and deleted_at is null and not mls_ready$x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: AI flag check not found'; end if;
  src := replace(src, pat, $x$where id in (select lm.media_id from public.listing_media lm where lm.home_id = p_home)
    and kind = 'photo' and deleted_at is null and not mls_ready$x$);

  execute src;
end $do$;
