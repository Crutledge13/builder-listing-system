-- Owners, 29 Oct 2026:
-- 1. Comp requests carry the ZIP code(s) to pull from.
-- 2. Each home can have GPS coordinates (new lots often aren't on the maps yet).

-- ---------------------------------------------------------------------------
-- 1. ZIP codes on comp requests
-- ---------------------------------------------------------------------------
alter table public.comp_requests add column zip_codes text[] not null default '{}'
  check (cardinality(zip_codes) <= 10 and array_to_string(zip_codes, ',') ~ '^([0-9]{5}(,[0-9]{5})*)?$');

-- New requests for a home start from the home's ZIP when none is given.
create or replace function public.comp_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; c record;
begin
  if tg_op = 'INSERT' then
    if new.home_id is not null then
      select id, builder_id, community_id, unparsed_address, city, postal_code into h from public.homes where id = new.home_id;
      if h.id is null then raise exception 'Unknown home'; end if;
      new.builder_id := h.builder_id;
      new.community_id := h.community_id;
      if cardinality(coalesce(new.zip_codes, '{}')) = 0 and h.postal_code ~ '^[0-9]{5}' then
        new.zip_codes := array[left(h.postal_code, 5)];
      end if;
    end if;
    if new.community_id is not null then
      select id, builder_id, city into c from public.communities where id = new.community_id;
      if c.id is null then raise exception 'Unknown community'; end if;
      new.builder_id := c.builder_id;
      new.city := coalesce(nullif(trim(new.city), ''), c.city);
    end if;
    new.zip_codes := coalesce(new.zip_codes, '{}');
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.requester_name := (select full_name from public.profiles where id = new.requested_by);
    new.status := 'requested';
    new.result_note := null;
    new.delivered_at := null;
    return new;
  end if;
  new.builder_id := old.builder_id;
  new.requested_by := old.requested_by;
  if not private.is_staff() and auth.uid() is not null then
    if new.status <> old.status and not (new.status = 'cancelled' and old.status = 'requested') then
      raise exception 'Our team updates comp requests' using errcode = '42501';
    end if;
    if new.result_note is distinct from old.result_note then
      raise exception 'Our team updates comp requests' using errcode = '42501';
    end if;
  end if;
  if new.status = 'delivered' and old.status <> 'delivered' then new.delivered_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.comp_requests_guard() from public, anon, authenticated;

-- Our team's task and email show the ZIP codes.
create or replace function public.comp_requests_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b text; what text; zips text;
begin
  select name into b from public.builders where id = new.builder_id;
  zips := nullif(array_to_string(new.zip_codes, ', '), '');
  what := new.location || coalesce(', ' || new.city, '') || coalesce(' (ZIP ' || zips || ')', '');
  if tg_op = 'INSERT' then
    perform private.add_task('comps', 'Pull comps for ' || what,
      'Requested by ' || coalesce(new.requester_name, 'the builder') || ' (' || coalesce(b, '') || ').'
        || coalesce(E'\nZIP codes: ' || zips, '')
        || coalesce(E'\nPrice point: $' || to_char(new.price_point, 'FM999,999,999'), '')
        || coalesce(E'\nSize: ' || new.living_area || ' sq ft', '')
        || coalesce(E'\nBeds/baths: ' || new.bedrooms || ' / ' || new.bathrooms, '')
        || coalesce(E'\nNotes: ' || new.notes, ''),
      new.home_id, new.community_id, new.builder_id, 'comp_requests', new.id, now() + interval '2 days', 'normal');
    perform private.queue_team_email('Comp request: ' || what,
      coalesce(new.requester_name, 'Someone') || ' at ' || coalesce(b, 'a builder') || ' asked for comps for ' || what || '.'
        || coalesce(E'\n\nNotes: ' || new.notes, '') || E'\n\nIt''s on the task board.',
      'comp_requests', new.id);
    if new.home_id is not null then perform private.log_activity(new.home_id, 'comps_requested', '{}'::jsonb); end if;
  elsif new.status <> old.status then
    if new.status = 'delivered' then
      perform private.close_tasks('comp_requests', new.id);
      perform private.notify(new.requested_by, 'comps', 'Your comps are ready: ' || what, new.result_note, '/comps/' || new.id);
      perform private.queue_email_to(new.requested_by, 'Your comps are ready: ' || what,
        'Our team pulled the comps you asked for (' || what || ').' || coalesce(E'\n\n' || new.result_note, '')
          || E'\n\nSee them in Builder Listings under Comps.', 'comp_requests', new.id);
    elsif new.status = 'cancelled' then perform private.close_tasks('comp_requests', new.id, null, 'cancelled');
    end if;
    if new.home_id is not null then perform private.log_activity(new.home_id, 'comps_' || new.status, '{}'::jsonb); end if;
  end if;
  return new;
end $$;
revoke all on function public.comp_requests_after() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. GPS coordinates on homes (RESO Latitude / Longitude)
-- ---------------------------------------------------------------------------
alter table public.homes
  add column latitude numeric(9,6) check (latitude between -90 and 90),
  add column longitude numeric(9,6) check (longitude between -180 and 180),
  add constraint homes_gps_pair check ((latitude is null) = (longitude is null));
