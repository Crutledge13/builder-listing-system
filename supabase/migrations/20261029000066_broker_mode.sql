-- Broker mode (owners, 29 Oct 2026): a builder lists through its own outside
-- broker instead of our team. The builder does everything in the full system
-- and approves a listing with "Approve and send to broker"; the broker signs in
-- to a bare set of screens (/broker) with only the MLS work for the builders
-- who invited them: a to-do list, the work sheet with copy buttons and ticks,
-- the MLS photo pack, and "MLS number -> mark live". The builder never sees the
-- broker's view; they get a notice and an email each time the broker finishes.
--
-- Brokers get NO access to the main tables (homes, media, tasks, settings...).
-- Everything they see comes through the functions below, each of which checks
-- "is this an MLS task for a builder that is in broker mode and has invited
-- you?" first (private.broker_task). Billing: the builder pays; nothing here
-- charges the broker.

-- ---------------------------------------------------------------------------
-- 1. The role, the setting and who works for whom
-- ---------------------------------------------------------------------------

-- Brokers, like our staff and photographers, belong to no builder.
alter table public.profiles drop constraint profile_builder_matches_role;
alter table public.profiles add constraint profile_builder_matches_role check (
  (role in ('platform_admin', 'listing_coordinator', 'photographer', 'broker') and builder_id is null)
  or (role not in ('platform_admin', 'listing_coordinator', 'photographer', 'broker') and builder_id is not null)
);

-- When a broker accepted the terms of use (shown on their first sign-in).
alter table public.profiles add column broker_terms_at timestamptz;

-- Who enters a builder's listings in the MLS: our team, the builder's own
-- team, or the builder's outside broker. Only our admins change it
-- (builder_settings_mls_entry_guard, unchanged).
alter table public.builder_settings drop constraint builder_settings_mls_entry_check;
alter table public.builder_settings add constraint builder_settings_mls_entry_check
  check (mls_entry in ('our_team', 'builder', 'broker'));

-- Which builders a broker works for. Filled only through invite_broker /
-- add_broker (the builder's owner or our admins), removable by them any time.
-- Rows are never deleted: removing sets removed_at, so the history stays.
create table public.broker_builders (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.profiles(id) on delete cascade,
  builder_id uuid not null references public.builders(id) on delete cascade,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz,
  unique (broker_id, builder_id)
);
create index broker_builders_builder_idx on public.broker_builders (builder_id);
alter table public.broker_builders enable row level security;
-- Seen by the broker themselves, our staff for that builder, and the builder's owner, managers and marketing.
-- No insert/update/delete rules: changes go only through the functions below.
create policy "see broker links" on public.broker_builders for select to authenticated
  using (broker_id = (select auth.uid())
    or private.staff_for(builder_id)
    or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));

-- Is this builder in broker mode?
create or replace function private.broker_mode(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select mls_entry = 'broker' from public.builder_settings where builder_id = b), false)
$$;
revoke all on function private.broker_mode(uuid) from public, anon;
grant execute on function private.broker_mode(uuid) to authenticated;

-- Is the signed-in person an active broker working for this builder, and is
-- the builder in broker mode? Always true or false, never null.
create or replace function private.broker_for(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(b is not null
    and private.my_role() = 'broker'
    and private.broker_mode(b)
    and exists (select 1 from public.broker_builders l
                where l.broker_id = (select auth.uid()) and l.builder_id = b and l.removed_at is null), false)
$$;
revoke all on function private.broker_for(uuid) from public, anon;
grant execute on function private.broker_for(uuid) to authenticated;

-- One MLS task, only if the signed-in broker may work it (else nothing).
create or replace function private.broker_task(p_task uuid) returns public.tasks
language sql stable security definer set search_path = '' as $$
  select t.* from public.tasks t
  where t.id = p_task and private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
$$;
revoke all on function private.broker_task(uuid) from public, anon, authenticated;

-- Who may add or remove a builder's broker: that builder's owner, or our platform admins.
create or replace function private.can_manage_brokers(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(b is not null and (private.my_role() = 'platform_admin'
    or (private.my_role() = 'builder_owner' and private.my_builder_id() = b)), false)
$$;
revoke all on function private.can_manage_brokers(uuid) from public, anon;
grant execute on function private.can_manage_brokers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The builder's side: adding, listing and removing their broker
-- ---------------------------------------------------------------------------

create or replace function private.log_broker(p_builder uuid, p_broker uuid, p_action text)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_log (builder_id, actor_id, action, changes)
  select p_builder, auth.uid(), p_action, jsonb_build_object('person_id', p.id, 'name', p.full_name, 'email', p.email)
  from public.profiles p where p.id = p_broker
$$;
revoke all on function private.log_broker(uuid, uuid, text) from public, anon, authenticated;

-- A builder's brokers (current first), for the Team page and Admin.
create or replace function public.builder_brokers(p_builder uuid)
returns table (broker_id uuid, full_name text, email text, phone text, is_active boolean, added_at timestamptz, removed_at timestamptz, needs_password boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.phone, p.is_active, l.added_at, l.removed_at,
         coalesce((u.raw_user_meta_data ->> 'needs_password')::boolean, false)
  from public.broker_builders l
  join public.profiles p on p.id = l.broker_id
  left join auth.users u on u.id = p.id
  where l.builder_id = p_builder
    and (private.staff_for(p_builder)
         or (p_builder = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')))
  order by l.removed_at nulls first, l.added_at desc
$$;
revoke all on function public.builder_brokers(uuid) from public, anon;
grant execute on function public.builder_brokers(uuid) to authenticated;

-- Link a broker who already has a login (they work for another builder too).
-- Returns 'linked', 'already' (they're already this builder's broker), or 'none' when nobody has that email (the caller then
-- makes the login and calls add_broker). Refuses an email that belongs to
-- someone who isn't a broker.
create or replace function public.link_broker(p_builder uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare p record; n int;
begin
  if not private.can_manage_brokers(p_builder) then
    raise exception 'Only the builder''s owner (or our admins) can add a broker' using errcode = '42501';
  end if;
  select id, role, is_active into p from public.profiles where lower(email) = lower(trim(p_email));
  if p.id is null then return 'none'; end if;
  if p.role <> 'broker' then
    raise exception 'That email already belongs to someone in Builder Listings who isn''t a broker' using errcode = '23505';
  end if;
  if not p.is_active then
    raise exception 'That broker''s access is turned off. Ask our team to turn it back on' using errcode = '42501';
  end if;
  insert into public.broker_builders (broker_id, builder_id, added_by) values (p.id, p_builder, auth.uid())
  on conflict (broker_id, builder_id) do update set removed_at = null, removed_by = null, added_at = now(), added_by = auth.uid()
    where public.broker_builders.removed_at is not null;
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;
  perform private.log_broker(p_builder, p.id, 'person_broker_added');
  return 'linked';
end $$;
revoke all on function public.link_broker(uuid, text) from public, anon;
grant execute on function public.link_broker(uuid, text) to authenticated;

-- A brand-new broker: our server made the login (no email sent); this saves
-- their profile and links them to the builder. Only for a login with no profile yet.
create or replace function public.add_broker(p_builder uuid, p_user uuid, p_email text, p_name text, p_phone text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_brokers(p_builder) then
    raise exception 'Only the builder''s owner (or our admins) can add a broker' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and lower(u.email) = lower(trim(p_email))) then
    raise exception 'That login wasn''t found' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That person is already set up' using errcode = '23505';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the broker''s name' using errcode = '22023'; end if;
  -- The one place a broker profile is made (profiles_broker_guard checks this flag).
  perform set_config('app.broker_add', 'on', true);
  insert into public.profiles (id, email, full_name, role, builder_id, phone)
  values (p_user, lower(trim(p_email)), trim(p_name), 'broker', null, nullif(trim(coalesce(p_phone, '')), ''));
  perform set_config('app.broker_add', 'off', true);
  insert into public.broker_builders (broker_id, builder_id, added_by) values (p_user, p_builder, auth.uid());
  perform private.log_broker(p_builder, p_user, 'person_broker_added');
end $$;
revoke all on function public.add_broker(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.add_broker(uuid, uuid, text, text, text) to authenticated;

-- Take a broker off a builder. Their login stays (they may work for other
-- builders); they simply stop seeing this builder's work.
create or replace function public.remove_broker(p_builder uuid, p_broker uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_manage_brokers(p_builder) then
    raise exception 'Only the builder''s owner (or our admins) can remove a broker' using errcode = '42501';
  end if;
  update public.broker_builders set removed_at = now(), removed_by = auth.uid()
  where builder_id = p_builder and broker_id = p_broker and removed_at is null;
  if found then perform private.log_broker(p_builder, p_broker, 'person_broker_removed'); end if;
end $$;
revoke all on function public.remove_broker(uuid, uuid) from public, anon;
grant execute on function public.remove_broker(uuid, uuid) to authenticated;

-- May the signed-in builder owner (or admin) make an invite link for this broker?
create or replace function public.can_invite_broker(p_broker uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
    or exists (select 1 from public.broker_builders l join public.profiles p on p.id = l.broker_id
               where l.broker_id = p_broker and l.removed_at is null and p.role = 'broker' and p.is_active
                 and private.can_manage_brokers(l.builder_id)), false)
$$;
revoke all on function public.can_invite_broker(uuid) from public, anon;
grant execute on function public.can_invite_broker(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The broker's side: their to-do list, one work sheet, and the actions
-- ---------------------------------------------------------------------------

-- Their to-do list: MLS work for the builders they work for (not cancelled).
create or replace function public.broker_tasks()
returns table (id uuid, kind text, title text, status text, priority text, due_at timestamptz, created_at timestamptz,
               completed_at timestamptz, builder_name text, address text, mls_number text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.kind, t.title, t.status, t.priority, t.due_at, t.created_at, t.completed_at,
         replace(b.name, ' (demo)', ''), h.unparsed_address, h.mls_number
  from public.tasks t
  join public.builders b on b.id = t.builder_id
  left join public.homes h on h.id = t.home_id
  where private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
  order by (t.status in ('todo', 'in_progress')) desc, t.priority = 'high' desc, t.due_at nulls last, t.created_at desc
  limit 300
$$;
revoke all on function public.broker_tasks() from public, anon;
grant execute on function public.broker_tasks() to authenticated;

-- One photo or video as the work sheet shows it (same fields the app's media list uses).
create or replace function private.broker_media_json(m public.media) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'title', m.title, 'kind', m.kind, 'room', m.room, 'tags', m.tags, 'source', m.source, 'demo_key', m.demo_key,
    'mime_type', m.mime_type, 'thumb_path', m.thumb_path, 'home_id', m.home_id, 'community_id', m.community_id,
    'builder_id', m.builder_id, 'is_cover', m.is_cover, 'mls_ready', m.mls_ready, 'sort_order', m.sort_order,
    'created_at', m.created_at, 'duration_seconds', m.duration_seconds, 'room_source', m.room_source, 'ai_status', m.ai_status,
    'ai_suggestion', m.ai_suggestion, 'caption', m.caption, 'plan_name', m.plan_name,
    'homes', (select jsonb_build_object('unparsed_address', h.unparsed_address, 'stories', h.stories, 'plan_name', h.plan_name,
                'bedrooms_total', h.bedrooms_total, 'bathrooms_full', h.bathrooms_full, 'bathrooms_half', h.bathrooms_half,
                'living_area', h.living_area) from public.homes h where h.id = m.home_id),
    'communities', (select jsonb_build_object('name', c.name) from public.communities c where c.id = m.community_id),
    'builders', (select jsonb_build_object('name', b.name) from public.builders b where b.id = m.builder_id))
$$;
revoke all on function private.broker_media_json(public.media) from public, anon, authenticated;

-- Everything one work sheet needs, in one answer, or null if the broker may not see it.
create or replace function public.broker_task_sheet(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.tasks; h public.homes; res jsonb; photo_ids uuid[];
begin
  t := private.broker_task(p_task);
  if t.id is null then return null; end if;
  select * into h from public.homes where id = t.home_id and deleted_at is null;

  res := jsonb_build_object(
    'task', jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'details', t.details, 'status', t.status,
      'priority', t.priority, 'due_at', t.due_at, 'created_at', t.created_at, 'completed_at', t.completed_at,
      'changes', t.changes, 'checked', t.checked, 'source_table', t.source_table, 'source_id', t.source_id, 'home_id', t.home_id),
    'builder_name', (select replace(name, ' (demo)', '') from public.builders where id = t.builder_id),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at,
                 'mine', n.author_id = auth.uid(),
                 'author', case when n.author_id = auth.uid() then 'You'
                                when p.role = 'broker' then p.full_name
                                else 'Builder Listings team' end) order by n.created_at)
               from public.task_notes n left join public.profiles p on p.id = n.author_id where n.task_id = t.id), '[]'::jsonb));

  if h.id is not null then
    res := res || jsonb_build_object(
      -- The home, minus internal bookkeeping the MLS doesn't need.
      'home', (to_jsonb(h) - array['field_sources', 'updated_by', 'website_page_url', 'approved_at', 'live_at',
                                   'market_status_at', 'availability_confirmed_at', 'created_at', 'deleted_at'])
              || jsonb_build_object(
                   'builders', (select jsonb_build_object('name', b.name, 'legal_name', b.legal_name) from public.builders b where b.id = h.builder_id),
                   'communities', (select jsonb_build_object('name', c.name, 'county', c.county, 'mls_fields', c.mls_fields)
                                   from public.communities c where c.id = h.community_id)),
      'mls_rows', coalesce((select jsonb_agg(jsonb_build_object('home_id', d.home_id, 'community_id', d.community_id, 'data', d.data))
                            from public.mls_details d where d.home_id = h.id or d.community_id = h.community_id), '[]'::jsonb),
      'board', (select jsonb_build_object('code', b.code, 'name', b.name, 'short_name', b.short_name, 'region', b.region,
                  'counties', b.counties, 'rules', b.rules, 'field_rules', b.field_rules, 'extra_fields', b.extra_fields)
                from public.mls_boards b where b.code = h.mls_board),
      -- Title company: only what goes on the MLS (not the escrow officer's contact).
      'title', (select jsonb_build_object('title_company_name', s.title_company_name, 'title_company_location', s.title_company_location,
                  'title_company_phone', s.title_company_phone, 'title_company_contact', null, 'title_company_email', null)
                from public.builder_settings s where s.builder_id = h.builder_id),
      -- The listing in MLS order: photos, floor plans, video and tours.
      'listing', coalesce((select jsonb_agg(jsonb_build_object('id', lm.id, 'position', lm.position,
                   'media', (select private.broker_media_json(m) from public.media m where m.id = lm.media_id and m.deleted_at is null),
                   'tour', (select jsonb_build_object('id', v.id, 'home_id', v.home_id, 'community_id', v.community_id, 'provider', v.provider,
                              'url', v.url, 'branded', v.branded, 'title', v.title, 'added_by_role', v.added_by_role, 'created_at', v.created_at)
                            from public.virtual_tours v where v.id = lm.tour_id and v.deleted_at is null)) order by lm.position)
                 from public.listing_media lm where lm.home_id = h.id), '[]'::jsonb),
      'incentives', coalesce((select jsonb_agg(to_jsonb(i) - array['created_by', 'updated_by', 'ended_by'])
                   from public.home_incentives(h.id) i), '[]'::jsonb));
  end if;

  -- Photos added or taken off a live listing (an update task).
  select coalesce(array_agg(x::uuid), '{}') into photo_ids
  from jsonb_array_elements_text(coalesce(t.changes -> 'photos' -> 'added', '[]') || coalesce(t.changes -> 'photos' -> 'removed', '[]')) x;
  if array_length(photo_ids, 1) > 0 then
    res := res || jsonb_build_object('change_media', coalesce((select jsonb_agg(private.broker_media_json(m))
             from public.media m where m.id = any (photo_ids) and m.builder_id = t.builder_id), '[]'::jsonb));
  end if;

  -- Open house dates (an open house task).
  if t.kind = 'open_house_mls' and t.source_id is not null then
    res := res || jsonb_build_object('open_houses', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'starts_at', o.starts_at,
             'ends_at', o.ends_at, 'remarks', o.remarks, 'cancelled_at', o.cancelled_at) order by o.starts_at)
           from public.open_houses o
           where o.home_id = t.home_id and case
             when t.source_table in ('open_houses', 'open_houses_cancel') then o.id = t.source_id
             when t.source_table = 'open_house_series' then o.series_id = t.source_id and o.cancelled_at is null and o.ends_at >= t.created_at
             when t.source_table = 'open_house_series_end' then o.series_id = t.source_id and o.cancelled_at is not null and o.starts_at >= t.created_at
             else false end), '[]'::jsonb));
  end if;
  return res;
end $$;
revoke all on function public.broker_task_sheet(uuid) from public, anon;
grant execute on function public.broker_task_sheet(uuid) to authenticated;

-- Start, finish or reopen a task. A new listing finishes by marking it live
-- (broker_mark_live), not with this.
create or replace function public.broker_set_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if p_status not in ('todo', 'in_progress', 'done') then raise exception 'Unknown status' using errcode = '22023'; end if;
  if p_status = 'done' and t.kind = 'mls_entry' then
    raise exception 'Enter the MLS number to finish a new listing' using errcode = '22023';
  end if;
  update public.tasks set status = p_status where id = t.id;
end $$;
revoke all on function public.broker_set_status(uuid, text) from public, anon;
grant execute on function public.broker_set_status(uuid, text) to authenticated;

-- Tick one line of the work sheet as entered in the MLS.
create or replace function public.broker_toggle_check(p_task uuid, p_item text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if t.status = 'done' then raise exception 'That task is finished' using errcode = '22023'; end if;
  if length(coalesce(p_item, '')) not between 1 and 200 then raise exception 'Unknown line' using errcode = '22023'; end if;
  update public.tasks set checked = case
      when p_on then (select array_agg(distinct x) from unnest(checked || p_item) x)
      else array_remove(checked, p_item) end
  where id = t.id;
end $$;
revoke all on function public.broker_toggle_check(uuid, text, boolean) from public, anon;
grant execute on function public.broker_toggle_check(uuid, text, boolean) to authenticated;

-- The listing is submitted: record its MLS number and mark it live. That
-- closes the "Enter in MLS" task (the homes triggers do it), which tells the builder.
create or replace function public.broker_mark_live(p_task uuid, p_mls text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; n text := trim(coalesce(p_mls, ''));
begin
  t := private.broker_task(p_task);
  if t.id is null or t.kind <> 'mls_entry' then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if n = '' or length(n) > 40 then raise exception 'Enter the MLS number the MLS gave this listing' using errcode = '22023'; end if;
  if not exists (select 1 from public.homes where id = t.home_id and workflow_status = 'approved_for_mls' and deleted_at is null) then
    raise exception 'This home isn''t waiting to go on the MLS any more' using errcode = '22023';
  end if;
  -- Trusted change: the broker isn't a builder role, so skip the per-role edit
  -- rules for exactly these two columns (the check above stands in for them).
  perform set_config('app.system_update', 'on', true);
  update public.homes set workflow_status = 'live_on_mls', mls_number = n where id = t.home_id;
  perform set_config('app.system_update', 'off', true);
  update public.tasks set status = 'done' where id = t.id and status <> 'done';
end $$;
revoke all on function public.broker_mark_live(uuid, text) from public, anon;
grant execute on function public.broker_mark_live(uuid, text) to authenticated;

-- A note on a task (a question for the builder, say). The builder's owner,
-- managers and marketing get it in their inbox and by email.
create or replace function public.broker_add_note(p_task uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; b text := trim(coalesce(p_body, '')); addr text; p record; me text;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if b = '' or length(b) > 2000 then raise exception 'Write a note first (up to 2,000 characters)' using errcode = '22023'; end if;
  insert into public.task_notes (task_id, author_id, body) values (t.id, auth.uid(), b);
  select unparsed_address into addr from public.homes where id = t.home_id;
  select full_name into me from public.profiles where id = auth.uid();
  perform private.notify_builder(t.builder_id, array['builder_owner', 'manager', 'marketing'], t.community_id, 'mls',
    'Note from your broker: ' || coalesce(addr, t.title), me || ': ' || b, coalesce('/homes/' || t.home_id, '/communities'));
  for p in select id from public.profiles where builder_id = t.builder_id and is_active and role in ('builder_owner', 'marketing') loop
    perform private.queue_email_to(p.id, 'Note from your broker: ' || coalesce(addr, t.title),
      me || ' left a note on ' || coalesce(addr, t.title) || E':\n\n' || b, 'tasks', t.id);
  end loop;
end $$;
revoke all on function public.broker_add_note(uuid, text) from public, anon;
grant execute on function public.broker_add_note(uuid, text) to authenticated;

-- The terms of use, accepted once on first sign-in.
create or replace function public.broker_accept_terms() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set broker_terms_at = coalesce(broker_terms_at, now())
  where id = auth.uid() and role = 'broker' and is_active
$$;
revoke all on function public.broker_accept_terms() from public, anon;
grant execute on function public.broker_accept_terms() to authenticated;

-- Which builders the signed-in broker works for, and whether they've accepted the terms.
create or replace function public.broker_me()
returns table (full_name text, terms_at timestamptz, builders text[])
language sql stable security definer set search_path = '' as $$
  select p.full_name, p.broker_terms_at,
    coalesce((select array_agg(replace(b.name, ' (demo)', '') order by b.name) from public.broker_builders l
              join public.builders b on b.id = l.builder_id
              where l.broker_id = p.id and l.removed_at is null and private.broker_mode(l.builder_id)), '{}')
  from public.profiles p where p.id = auth.uid() and p.role = 'broker' and p.is_active
$$;
revoke all on function public.broker_me() from public, anon;
grant execute on function public.broker_me() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Files: a broker may open the photos and videos on their work sheets
-- ---------------------------------------------------------------------------

-- Media a broker's task shows: the home's listing, plus photos added or taken
-- off on an update task.
create or replace function private.broker_task_media(t public.tasks) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select lm.media_id from public.listing_media lm where lm.home_id = t.home_id and lm.media_id is not null
  union
  select x::uuid from jsonb_array_elements_text(coalesce(t.changes -> 'photos' -> 'added', '[]') || coalesce(t.changes -> 'photos' -> 'removed', '[]')) x
$$;
revoke all on function private.broker_task_media(public.tasks) from public, anon, authenticated;

-- One file for the file link (/broker/file/...), checked against the task.
create or replace function public.broker_file(p_task uuid, p_media uuid)
returns table (storage_path text, title text, source text, demo_key text, kind text, thumb_path text, web_path text)
language sql stable security definer set search_path = '' as $$
  select m.storage_path, m.title, m.source, m.demo_key, m.kind, m.thumb_path, m.web_path
  from public.media m, private.broker_task(p_task) t
  where t.id is not null and m.id = p_media and m.deleted_at is null and m.builder_id = t.builder_id
    and m.id in (select private.broker_task_media(t))
$$;
revoke all on function public.broker_file(uuid, uuid) from public, anon;
grant execute on function public.broker_file(uuid, uuid) to authenticated;

-- Storage: brokers may make a private link only for files on their MLS work.
create or replace function private.broker_sees_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'broker' and exists (
    select 1 from public.media m
    join public.tasks t on t.builder_id = m.builder_id
    where (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name) and m.deleted_at is null
      and private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
      and m.id in (select private.broker_task_media(t))), false)
$$;
revoke all on function private.broker_sees_file(text) from public, anon;
grant execute on function private.broker_sees_file(text) to authenticated;
create policy "media files: brokers on their MLS work" on storage.objects for select to authenticated
  using (bucket_id = 'media' and private.broker_sees_file(name));

-- ---------------------------------------------------------------------------
-- 5. Notices: new work to the broker; finished work back to the builder
-- ---------------------------------------------------------------------------

create or replace function public.tasks_broker_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p record; subject text; addr text; sent int := 0;
begin
  if not private.is_mls_task(new.kind) or new.builder_id is null or not private.broker_mode(new.builder_id) then return null; end if;
  select unparsed_address into addr from public.homes where id = new.home_id;
  subject := case new.kind
    when 'mls_entry' then 'New listing to enter on the MLS: '
    when 'mls_update' then 'Update an MLS listing: '
    when 'open_house_mls' then 'Open house to put on the MLS: '
    else 'Listing status to change on the MLS: ' end
    || coalesce(addr, new.title)
    || ' (' || (select replace(name, ' (demo)', '') from public.builders where id = new.builder_id) || ')';
  for p in select l.broker_id from public.broker_builders l join public.profiles pr on pr.id = l.broker_id
           where l.builder_id = new.builder_id and l.removed_at is null and pr.is_active and pr.role = 'broker' loop
    perform private.queue_email_to(p.broker_id, subject,
      coalesce(new.details || E'\n\n', '') || 'Sign in to Builder Listings to open the work sheet: every field to copy into the MLS, the photo pack and the MLS number box.'
        || case when new.due_at is not null then E'\n\nDue ' || to_char(new.due_at at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central.' else '' end,
      'tasks', new.id);
    sent := sent + 1;
  end loop;
  -- No broker yet: the builder's owner needs to add one, or nobody will enter it.
  if sent = 0 then
    perform private.notify_builder(new.builder_id, array['builder_owner'], null, 'mls',
      'Add your listing broker: ' || coalesce(addr, new.title) || ' is waiting',
      'Your listings go to your own broker, but none is set up yet. Add them on the Team page.', '/team#broker');
  end if;
  return null;
end $$;
revoke all on function public.tasks_broker_notice() from public, anon, authenticated;
create trigger tasks_broker_notice after insert on public.tasks
  for each row execute function public.tasks_broker_notice();

create or replace function public.tasks_broker_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; subject text; body text; p record;
begin
  if new.status <> 'done' or old.status = 'done' or not private.is_mls_task(new.kind)
     or new.builder_id is null or not private.broker_mode(new.builder_id) then
    return null;
  end if;
  select unparsed_address, mls_number, mls_board into h from public.homes where id = new.home_id;
  subject := case new.kind
    when 'mls_entry' then 'Live on the MLS: ' || coalesce(h.unparsed_address, new.title) || coalesce(' (#' || h.mls_number || ')', '')
    when 'mls_update' then 'Your broker updated the MLS: ' || coalesce(h.unparsed_address, new.title)
    when 'open_house_mls' then 'Open house updated on the MLS: ' || coalesce(h.unparsed_address, new.title)
    else 'Your broker changed the status on the MLS: ' || coalesce(h.unparsed_address, new.title) end;
  body := case new.kind
    when 'mls_entry' then 'Your broker entered it on ' || coalesce(h.mls_board, 'the MLS') || coalesce(' as #' || h.mls_number, '') || '.'
    else 'Your broker finished: ' || new.title || '.' end;
  perform private.notify_builder(new.builder_id, array['builder_owner', 'manager', 'marketing'], new.community_id, 'mls',
    subject, body, coalesce('/homes/' || new.home_id, '/communities'));
  for p in select id from public.profiles where builder_id = new.builder_id and is_active and role in ('builder_owner', 'marketing') loop
    perform private.queue_email_to(p.id, subject, body, 'tasks', new.id);
  end loop;
  return null;
end $$;
revoke all on function public.tasks_broker_done() from public, anon, authenticated;
create trigger tasks_broker_done after update of status on public.tasks
  for each row execute function public.tasks_broker_done();

-- ---------------------------------------------------------------------------
-- 6. Nobody becomes (or stops being) a broker except through add_broker
-- ---------------------------------------------------------------------------
-- A broker's login is set up with the sign-in routing that keeps them in
-- /broker, so the role can't be picked anywhere else (Admin > People, join
-- links, Team page). Seed files (no signed-in user) may still make one.
create or replace function public.profiles_broker_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or current_setting('app.broker_add', true) = 'on' then return new; end if;
  if (tg_op = 'INSERT' and new.role = 'broker')
     or (tg_op = 'UPDATE' and (new.role = 'broker') is distinct from (old.role = 'broker')) then
    raise exception 'Brokers are added by their builder (Team page), not by changing someone''s role' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.profiles_broker_guard() from public, anon, authenticated;
create trigger profiles_broker_guard before insert or update on public.profiles
  for each row execute function public.profiles_broker_guard();
