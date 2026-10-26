-- One shared list of photo tags.
--
-- Before: anyone could type any extra tag, so "amenity", "Amenities" and
-- "amenities" were three different tags. Now extra tags must come from
-- media_tags, which our admins manage. The tags the system adds on its own
-- (address, plan, community, room) are unchanged.
--
-- How it works:
--   * media_prepare maps every extra tag to its list label (matching the label
--     or any alias, ignoring case) and drops anything not on the list.
--   * Retired tags can't be picked any more but stay on photos that have them.
--   * Renaming a tag keeps the old name as an alias and updates every photo.
--   * Merging moves a tag's photos to another tag and keeps the old name as an alias.
--   * Builders ask for new tags through media_tag_requests; admins approve or reject.

create table public.media_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 40),
  category text not null default 'feature' check (category in ('shot', 'feature', 'outdoor', 'community')),
  aliases text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 100,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index media_tags_label_key on public.media_tags (lower(label));

alter table public.media_tags enable row level security;
create policy "everyone signed in reads the tag list" on public.media_tags
  for select to authenticated using (private.my_role() is not null);
create policy "admins manage the tag list" on public.media_tags
  for all to authenticated using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

create table public.media_tag_requests (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 40),
  note text check (length(note) <= 500),
  media_id uuid references public.media(id) on delete set null,
  builder_id uuid references public.builders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tag_id uuid references public.media_tags(id) on delete set null,
  answer text check (length(answer) <= 500),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index media_tag_requests_pending on public.media_tag_requests (created_at) where status = 'pending';

alter table public.media_tag_requests enable row level security;
-- People who tag photos (not sales) can ask; they see their own requests, staff see all.
create policy "taggers ask for tags" on public.media_tag_requests
  for insert to authenticated with check (
    requested_by = auth.uid() and status = 'pending'
    and private.my_role() in ('platform_admin', 'listing_coordinator', 'builder_owner', 'manager', 'marketing', 'photographer')
    and (builder_id is null or private.is_staff() or builder_id = private.my_builder_id())
    and (media_id is null or exists (select 1 from public.media m where m.id = media_id))
  );
create policy "see own or all as staff" on public.media_tag_requests
  for select to authenticated using (requested_by = auth.uid() or private.is_staff());
create policy "admins answer requests" on public.media_tag_requests
  for update to authenticated using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

-- Fill builder automatically from the requester.
create or replace function public.media_tag_requests_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.label := trim(new.label);
    new.builder_id := coalesce(new.builder_id, (select builder_id from public.profiles where id = new.requested_by));
  end if;
  return new;
end $$;
create trigger media_tag_requests_prepare before insert on public.media_tag_requests
  for each row execute function public.media_tag_requests_prepare();

-- Keep labels and aliases tidy, and refuse an alias that belongs to another tag.
create or replace function public.media_tags_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.label := trim(regexp_replace(new.label, '\s+', ' ', 'g'));
  new.aliases := coalesce((
    select array_agg(distinct lower(trim(a))) from unnest(new.aliases) a
    where trim(a) <> '' and lower(trim(a)) <> lower(new.label)
  ), '{}');
  if exists (
    select 1 from public.media_tags t
    where t.id <> new.id
      and (lower(t.label) = any(new.aliases) or lower(new.label) = any(t.aliases)
           or t.aliases && new.aliases)
  ) then
    raise exception 'That name or alias is already used by another tag';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger media_tags_prepare before insert or update on public.media_tags
  for each row execute function public.media_tags_prepare();

-- The list label for a typed tag, or null if it isn't on the list.
create or replace function private.tag_label(t text, allow_retired boolean default false) returns text
language sql stable security definer set search_path = '' as $$
  select label from public.media_tags
  where (lower(label) = lower(trim(t)) or lower(trim(t)) = any(aliases))
    and (active or allow_retired)
  limit 1
$$;

create or replace function public.media_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  h record;
  c record;
  auto text[] := '{}';
  extra text[] := '{}';
  t text;
  lbl text;
begin
  if new.home_id is not null then
    select id, builder_id, community_id, unparsed_address, plan_name into h from public.homes where id = new.home_id;
    if h.id is null then raise exception 'Unknown home'; end if;
    new.builder_id := h.builder_id;
    new.community_id := h.community_id;
    new.plan_name := null;
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
  if new.plan_name is not null then
    auto := auto || array[new.plan_name || ' plan', 'representative'];
  end if;
  if new.room is not null then
    -- A room that is also on the list (amenity, aerial, entrance...) uses the list's name.
    t := replace(replace(replace(new.room, 'primary_', 'primary '), '_', ' '), 'living', 'living room');
    auto := auto || coalesce(private.tag_label(t, true), t);
  end if;

  -- Extra tags: only from the shared list. A retired tag stays if the photo already had it.
  foreach t in array coalesce(new.tags, '{}') loop
    if exists (select 1 from unnest(auto) a where lower(a) = lower(trim(t))) then continue; end if;
    lbl := private.tag_label(t, false);
    if lbl is null and tg_op = 'UPDATE' then
      lbl := private.tag_label(t, true);
      if lbl is not null and not exists (select 1 from unnest(old.tags) o where lower(o) = lower(lbl)) then lbl := null; end if;
    end if;
    if lbl is not null then extra := extra || lbl; end if;
  end loop;

  select coalesce(array_agg(x.t order by x.min_ord), '{}') into new.tags from (
    select min(ord) as min_ord, (array_agg(trim(u.t) order by ord))[1] as t
    from unnest(extra || auto) with ordinality as u(t, ord)
    where trim(u.t) <> ''
    group by lower(trim(u.t))
  ) x;

  new.search_text := lower(concat_ws(' ', new.title, new.caption, new.room, array_to_string(new.tags, ' ')));
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  end if;
  return new;
end $$;

-- Re-run the tag rules on every photo that has one of these names.
create or replace function private.retag_media(names text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.media m set tags = m.tags
  where exists (select 1 from unnest(m.tags) x where lower(x) = any(select lower(y) from unnest(names) y));
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin: rename a tag. The old name becomes an alias and every photo updates.
create or replace function public.rename_media_tag(tag uuid, new_label text) returns int
language plpgsql security definer set search_path = '' as $$
declare old_label text;
begin
  if coalesce(private.my_role()::text, '') <> 'platform_admin' then raise exception 'Only admins can rename tags'; end if;
  select label into old_label from public.media_tags where id = tag;
  if old_label is null then raise exception 'Unknown tag'; end if;
  if lower(trim(new_label)) = lower(old_label) then
    update public.media_tags set label = new_label where id = tag;
  else
    update public.media_tags set label = new_label, aliases = aliases || lower(old_label) where id = tag;
  end if;
  return private.retag_media(array[old_label]);
end $$;

-- Admin: merge one tag into another. Photos move over; the old name becomes an alias.
create or replace function public.merge_media_tags(from_tag uuid, into_tag uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  if coalesce(private.my_role()::text, '') <> 'platform_admin' then raise exception 'Only admins can merge tags'; end if;
  if from_tag = into_tag then raise exception 'Pick a different tag to merge into'; end if;
  select label, aliases into f from public.media_tags where id = from_tag;
  if f.label is null or not exists (select 1 from public.media_tags where id = into_tag) then raise exception 'Unknown tag'; end if;
  update public.media_tag_requests set tag_id = into_tag where tag_id = from_tag;
  delete from public.media_tags where id = from_tag;
  update public.media_tags set aliases = aliases || lower(f.label) || f.aliases where id = into_tag;
  return private.retag_media(array[f.label]);
end $$;

-- Admin: approve a request, either as a new tag or as another name for an existing one.
-- If the request came from a photo, that photo gets the tag.
create or replace function public.approve_media_tag_request(request uuid, use_tag uuid, new_label text, new_category text, answer_text text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare r record; tid uuid; lbl text;
begin
  if coalesce(private.my_role()::text, '') <> 'platform_admin' then raise exception 'Only admins can approve tags'; end if;
  select * into r from public.media_tag_requests where id = request and status = 'pending';
  if r.id is null then raise exception 'That request was already answered'; end if;
  if use_tag is not null then
    tid := use_tag;
    select label into lbl from public.media_tags where id = tid;
    if lbl is null then raise exception 'Unknown tag'; end if;
    if lower(r.label) <> lower(lbl) and private.tag_label(r.label, true) is null then
      update public.media_tags set aliases = aliases || lower(r.label) where id = tid;
    end if;
  else
    lbl := coalesce(nullif(trim(new_label), ''), r.label);
    insert into public.media_tags (label, category) values (lbl, coalesce(new_category, 'feature')) returning id into tid;
    select label into lbl from public.media_tags where id = tid;
  end if;
  update public.media_tag_requests
    set status = 'approved', tag_id = tid, answer = nullif(trim(answer_text), ''), resolved_by = auth.uid(), resolved_at = now()
    where id = request;
  if r.media_id is not null then
    update public.media set tags = array_append(tags, lbl) where id = r.media_id and deleted_at is null;
  end if;
  return tid;
end $$;

revoke all on function public.rename_media_tag(uuid, text), public.merge_media_tags(uuid, uuid),
  public.approve_media_tag_request(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.rename_media_tag(uuid, text), public.merge_media_tags(uuid, uuid),
  public.approve_media_tag_request(uuid, uuid, text, text, text) to authenticated;
revoke all on function private.retag_media(text[]), private.tag_label(text, boolean) from public, anon, authenticated;

-- Starting list. Old free-typed tags map in through aliases.
insert into public.media_tags (label, category, aliases, sort) values
  ('Twilight', 'shot', '{dusk,night}', 10),
  ('Drone / aerial', 'shot', '{drone,aerial,aerial view,drone shot}', 20),
  ('Video tour', 'shot', '{walkthrough,walk-through,video walkthrough}', 30),
  ('Model home', 'shot', '{model}', 40),
  ('Curb appeal', 'shot', '{front elevation,street view}', 50),
  ('Detail shot', 'shot', '{detail,close-up}', 60),
  ('Virtually staged', 'shot', '{virtual staging,staged}', 70),
  ('Representative photo', 'shot', '{representative}', 80),
  ('Open concept', 'feature', '{open floor plan,open layout}', 10),
  ('Kitchen island', 'feature', '{island}', 20),
  ('Quartz countertops', 'feature', '{quartz}', 30),
  ('Granite countertops', 'feature', '{granite}', 40),
  ('Stainless appliances', 'feature', '{stainless steel appliances,stainless}', 50),
  ('Pendant lights', 'feature', '{pendant lighting,pendants}', 60),
  ('Walk-in pantry', 'feature', '{pantry}', 70),
  ('Vaulted ceiling', 'feature', '{vaulted ceilings,high ceilings}', 80),
  ('Fireplace', 'feature', '{}', 90),
  ('Wood-look floors', 'feature', '{hardwood floors,wood floors,lvp,luxury vinyl plank}', 100),
  ('Soaking tub', 'feature', '{garden tub,freestanding tub}', 110),
  ('Double vanity', 'feature', '{dual vanity,double sinks}', 120),
  ('Walk-in shower', 'feature', '{}', 130),
  ('Walk-in closet', 'feature', '{}', 140),
  ('Home office', 'feature', '{study,office}', 150),
  ('Game room', 'feature', '{loft,flex room}', 160),
  ('Media room', 'feature', '{theater room}', 170),
  ('Covered patio', 'outdoor', '{patio}', 10),
  ('Outdoor kitchen', 'outdoor', '{}', 20),
  ('Large backyard', 'outdoor', '{big backyard,large yard}', 30),
  ('Three-car garage', 'outdoor', '{3-car garage,3 car garage}', 40),
  ('Amenities', 'community', '{amenity,community amenities}', 10),
  ('Pool', 'community', '{community pool,resort pool}', 20),
  ('Playground', 'community', '{}', 30),
  ('Trails', 'community', '{walking trails,hike and bike trails}', 40),
  ('Clubhouse', 'community', '{amenity center}', 50),
  ('Park', 'community', '{green space}', 60),
  ('Pond / lake', 'community', '{pond,lake}', 70),
  ('Monument sign', 'community', '{community sign}', 80),
  ('Entrance', 'community', '{community entrance,entry}', 90),
  ('Site map', 'community', '{lot map,plat map}', 100);

-- One-time cleanup: run every photo through the new rules.
update public.media set tags = tags;
