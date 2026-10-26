-- Team management, our team's task board, listing status (pause/withdraw/
-- under contract/sold), repeating open houses within the MLS window, reverse
-- prospecting requests, issue reports, an email log and app settings.

-- ===========================================================================
-- Settings (readable by everyone signed in; changed by our admins)
-- ===========================================================================
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
create policy "everyone signed in reads settings" on public.app_settings for select to authenticated using (true);
create policy "admins change settings" on public.app_settings for all to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');
insert into public.app_settings (key, value) values
  ('mls_open_house_window_days', '28'),
  ('team_email', '"listings@example.com"')
on conflict (key) do nothing;

-- ===========================================================================
-- People: deactivate instead of delete; builder owners and managers run their team
-- ===========================================================================
alter table public.profiles add column is_active boolean not null default true;

-- A deactivated person has no role and no builder, so every rule denies them.
create or replace function private.my_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;
create or replace function private.my_builder_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select builder_id from public.profiles where id = auth.uid() and is_active
$$;
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('platform_admin', 'listing_coordinator') from public.profiles
                   where id = auth.uid() and is_active), false)
$$;

-- Owners add anyone on their builder's team; managers add sales and marketing.
create or replace function private.can_manage_person(target_role public.user_role, target_builder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_builder is not null
     and target_builder = private.my_builder_id()
     and ((private.my_role() = 'builder_owner' and target_role in ('builder_owner', 'manager', 'sales', 'marketing'))
       or (private.my_role() = 'manager' and target_role in ('sales', 'marketing')))
$$;
revoke execute on function private.can_manage_person(public.user_role, uuid) from public, anon;
grant execute on function private.can_manage_person(public.user_role, uuid) to authenticated;

create policy "builder leads add their people" on public.profiles for insert to authenticated
  with check (private.can_manage_person(role, builder_id));
create policy "builder leads edit their people" on public.profiles for update to authenticated
  using (private.can_manage_person(role, builder_id) and id <> auth.uid())
  with check (private.can_manage_person(role, builder_id));

-- ===========================================================================
-- Listing status on the market (RESO StandardStatus, simplified)
-- ===========================================================================
alter table public.homes
  add column market_status text check (market_status in ('active', 'paused', 'under_contract', 'sold', 'withdrawn')),
  add column show_representative_disclaimer boolean not null default false;
update public.homes set market_status = 'active' where workflow_status = 'live_on_mls';

-- Who may change which fields (replaces the earlier version).
create or replace function public.enforce_home_edit_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role := private.my_role();
  changed text[];
  allowed text[];
  bad text[];
begin
  if auth.uid() is null then
    if new.workflow_status = 'live_on_mls' and old.workflow_status <> 'live_on_mls' and new.market_status is null then
      new.market_status := 'active';
    end if;
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by', 'field_sources');

  if r = 'platform_admin' then
    allowed := changed;
  elsif r = 'listing_coordinator' then
    allowed := array['mls_number', 'workflow_status', 'market_status'];
  elsif r in ('builder_owner', 'manager') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer'];
  elsif r = 'sales' then
    allowed := array['list_price', 'build_stage', 'estimated_completion', 'workflow_status', 'market_status'];
  elsif r = 'marketing' then
    allowed := array['public_remarks', 'workflow_status', 'show_representative_disclaimer'];
  else
    allowed := '{}';
  end if;

  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);
  if array_length(bad, 1) > 0 then
    raise exception 'Your role (%) cannot change: %', r, array_to_string(bad, ', ') using errcode = '42501';
  end if;

  if new.workflow_status is distinct from old.workflow_status then
    if not (
      r = 'platform_admin'
      or (r in ('builder_owner', 'manager', 'sales', 'marketing')
          and new.workflow_status in ('draft', 'in_review') and old.workflow_status in ('draft', 'in_review'))
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'in_review' and new.workflow_status = 'approved_for_mls')
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'approved_for_mls' and new.workflow_status in ('draft', 'in_review'))
      or (r = 'listing_coordinator' and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')
    ) then
      raise exception 'Your role (%) cannot move a listing from % to %', r, old.workflow_status, new.workflow_status using errcode = '42501';
    end if;
  end if;

  if new.workflow_status = 'live_on_mls' and coalesce(new.mls_number, '') = '' then
    raise exception 'An MLS number is required before marking a listing live' using errcode = '23514';
  end if;
  if new.workflow_status = 'live_on_mls' and old.workflow_status <> 'live_on_mls' and new.market_status is null then
    new.market_status := 'active';
  end if;
  -- Sales can mark availability (active / under contract / sold) but not pause or withdraw.
  if new.market_status is distinct from old.market_status then
    if new.workflow_status <> 'live_on_mls' then
      raise exception 'Only a listing that''s live on the MLS has a market status' using errcode = '23514';
    end if;
    if r = 'sales' and new.market_status not in ('active', 'under_contract', 'sold') then
      raise exception 'Ask a manager or owner to pause or withdraw a listing' using errcode = '42501';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  -- Mark changed fields as entered by staff, unless the change itself said where
  -- the value came from (for example "website" when accepting a website value).
  select coalesce(new.field_sources, '{}'::jsonb)
         || coalesce(jsonb_object_agg(c, 'staff'), '{}'::jsonb)
    into new.field_sources
  from unnest(changed) c
  where c not in ('workflow_status', 'deleted_at', 'mls_number', 'market_status', 'show_representative_disclaimer')
    and (new.field_sources ->> c) is not distinct from (old.field_sources ->> c);

  return new;
end;
$$;

-- ===========================================================================
-- Our team's task board (staff only)
-- ===========================================================================
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('mls_entry', 'mls_update', 'open_house_mls', 'change_request', 'photo_request',
                                     'reverse_prospecting', 'listing_status', 'issue', 'other')),
  title text not null,
  details text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  due_at timestamptz,
  builder_id uuid references public.builders (id),
  home_id uuid references public.homes (id),
  community_id uuid references public.communities (id),
  assignee_id uuid references public.profiles (id),
  created_by uuid references auth.users (id),
  source_table text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users (id)
);
create index tasks_open_idx on public.tasks (status, due_at) where status in ('todo', 'in_progress');
create index tasks_source_idx on public.tasks (source_table, source_id);
create index tasks_home_idx on public.tasks (home_id);

create table public.task_notes (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references auth.users (id) default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index task_notes_task_idx on public.task_notes (task_id, created_at);

alter table public.tasks enable row level security;
alter table public.task_notes enable row level security;
revoke all on public.tasks, public.task_notes from anon;
create policy "staff see tasks" on public.tasks for select to authenticated using (private.is_staff());
create policy "staff add tasks" on public.tasks for insert to authenticated with check (private.is_staff());
create policy "staff update tasks" on public.tasks for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "staff see notes" on public.task_notes for select to authenticated using (private.is_staff());
create policy "staff add notes" on public.task_notes for insert to authenticated with check (private.is_staff() and author_id = auth.uid());

create or replace function public.tasks_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif new.status <> 'done' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;
revoke execute on function public.tasks_touch() from public, anon, authenticated;
create trigger tasks_touch before update on public.tasks for each row execute function public.tasks_touch();

-- Helpers the automatic triggers use.
create or replace function private.add_task(
  p_kind text, p_title text, p_details text, p_home uuid, p_community uuid, p_builder uuid,
  p_source_table text, p_source_id uuid, p_due timestamptz default null, p_priority text default 'normal')
returns uuid language plpgsql security definer set search_path = '' as $$
declare tid uuid; b uuid := p_builder; c uuid := p_community;
begin
  if p_home is not null then
    select builder_id, community_id into b, c from public.homes where id = p_home;
  elsif p_community is not null and b is null then
    select builder_id into b from public.communities where id = p_community;
  end if;
  insert into public.tasks (kind, title, details, home_id, community_id, builder_id, source_table, source_id, due_at, priority, created_by)
  values (p_kind, p_title, p_details, p_home, c, b, p_source_table, p_source_id, p_due, p_priority, auth.uid())
  returning id into tid;
  return tid;
end $$;

create or replace function private.close_tasks(p_source_table text, p_source_id uuid, p_kind text default null, p_status text default 'done')
returns void language sql security definer set search_path = '' as $$
  update public.tasks set status = p_status
  where source_table = p_source_table and source_id = p_source_id
    and (p_kind is null or kind = p_kind) and status in ('todo', 'in_progress')
$$;
revoke execute on function private.add_task(text, text, text, uuid, uuid, uuid, text, uuid, timestamptz, text),
  private.close_tasks(text, uuid, text, text) from public, anon, authenticated;

-- ===========================================================================
-- Email log. The app sends queued emails when an email service is set up;
-- until then they stay here (visible to our admins) so nothing is lost.
-- ===========================================================================
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  related_table text,
  related_id uuid,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon;
create policy "staff see the email log" on public.email_outbox for select to authenticated using (private.is_staff());

-- The server sends a just-queued email for the record the person just created,
-- then records the result. These two functions are the only way in for non-staff.
create or replace function public.queued_emails_for(p_table text, p_id uuid)
returns setof public.email_outbox language sql security definer set search_path = '' as $$
  select * from public.email_outbox
  where related_table = p_table and related_id = p_id and status = 'queued'
    and created_at > now() - interval '15 minutes'
$$;
create or replace function public.record_email_result(p_id uuid, p_status text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.email_outbox
  set status = p_status, error = p_error, sent_at = case when p_status = 'sent' then now() end
  where id = p_id and status = 'queued' and p_status in ('sent', 'skipped', 'failed')
    and created_at > now() - interval '15 minutes'
$$;
revoke execute on function public.queued_emails_for(text, uuid), public.record_email_result(uuid, text, text) from public, anon;
grant execute on function public.queued_emails_for(text, uuid), public.record_email_result(uuid, text, text) to authenticated;

create or replace function private.queue_team_email(p_subject text, p_body text, p_table text, p_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.email_outbox (to_email, subject, body, related_table, related_id)
  select coalesce((select value #>> '{}' from public.app_settings where key = 'team_email'), 'listings@example.com'),
         p_subject, p_body, p_table, p_id
$$;
revoke execute on function private.queue_team_email(text, text, text, uuid) from public, anon, authenticated;

-- ===========================================================================
-- Reverse prospecting requests (a manual pull by our team)
-- ===========================================================================
create table public.reverse_prospect_requests (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id),
  builder_id uuid not null references public.builders (id),
  requested_by uuid not null references auth.users (id),
  requester_name text,
  address text not null default '',
  notes text,
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'delivered', 'cancelled')),
  result_note text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reverse_prospect_home_idx on public.reverse_prospect_requests (home_id, created_at desc);
alter table public.reverse_prospect_requests enable row level security;
revoke all on public.reverse_prospect_requests from anon;
create policy "see reverse prospecting" on public.reverse_prospect_requests for select to authenticated
  using (exists (select 1 from public.homes h where h.id = home_id));
create policy "builder team requests reverse prospecting" on public.reverse_prospect_requests for insert to authenticated
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales', 'marketing')
              and exists (select 1 from public.homes h where h.id = home_id));
create policy "update reverse prospecting" on public.reverse_prospect_requests for update to authenticated
  using (private.is_staff() or (builder_id = private.my_builder_id() and exists (select 1 from public.homes h where h.id = home_id)))
  with check (private.is_staff() or builder_id = private.my_builder_id());

create or replace function public.reverse_prospect_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  if tg_op = 'INSERT' then
    select id, builder_id, unparsed_address, city into h from public.homes where id = new.home_id;
    new.builder_id := h.builder_id;
    new.address := h.unparsed_address || ', ' || h.city;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.requester_name := (select full_name from public.profiles where id = new.requested_by);
    new.status := 'requested';
    return new;
  end if;
  if not private.is_staff() and auth.uid() is not null then
    if new.status <> old.status and new.status <> 'cancelled' then
      raise exception 'Our team updates reverse prospecting requests' using errcode = '42501';
    end if;
    if new.result_note is distinct from old.result_note then
      raise exception 'Our team updates reverse prospecting requests' using errcode = '42501';
    end if;
  end if;
  if new.status = 'delivered' and old.status <> 'delivered' then new.delivered_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.reverse_prospect_guard() from public, anon, authenticated;
create trigger reverse_prospect_guard before insert or update on public.reverse_prospect_requests
  for each row execute function public.reverse_prospect_guard();

create or replace function public.reverse_prospect_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b text;
begin
  select name into b from public.builders where id = new.builder_id;
  if tg_op = 'INSERT' then
    perform private.add_task('reverse_prospecting', 'Pull a reverse prospecting list for ' || new.address,
      'Requested by ' || coalesce(new.requester_name, 'the builder') || ' (' || coalesce(b, '') || ').'
        || coalesce(E'\nNotes: ' || new.notes, ''),
      new.home_id, null, null, 'reverse_prospect_requests', new.id, now() + interval '2 days', 'normal');
    perform private.queue_team_email('Reverse prospecting request: ' || new.address,
      coalesce(new.requester_name, 'Someone') || ' at ' || coalesce(b, 'a builder') || ' asked for a reverse prospecting list for '
        || new.address || '.' || coalesce(E'\n\nNotes: ' || new.notes, '') || E'\n\nIt''s on the task board.',
      'reverse_prospect_requests', new.id);
    perform private.log_activity(new.home_id, 'reverse_prospect_requested', '{}'::jsonb);
  elsif new.status <> old.status then
    if new.status = 'delivered' then perform private.close_tasks('reverse_prospect_requests', new.id);
    elsif new.status = 'cancelled' then perform private.close_tasks('reverse_prospect_requests', new.id, null, 'cancelled');
    end if;
    perform private.log_activity(new.home_id, 'reverse_prospect_' || new.status, '{}'::jsonb);
  end if;
  return new;
end $$;
revoke execute on function public.reverse_prospect_after() from public, anon, authenticated;
create trigger reverse_prospect_after after insert or update on public.reverse_prospect_requests
  for each row execute function public.reverse_prospect_after();

-- ===========================================================================
-- Help and issue reports
-- ===========================================================================
create table public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  reported_by uuid not null references auth.users (id) default auth.uid(),
  reporter_name text,
  reporter_role text,
  builder_id uuid references public.builders (id),
  kind text not null default 'problem' check (kind in ('problem', 'question', 'idea')),
  page text,
  message text not null check (length(trim(message)) > 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
alter table public.issue_reports enable row level security;
revoke all on public.issue_reports from anon;
create policy "report an issue" on public.issue_reports for insert to authenticated with check (reported_by = auth.uid());
create policy "see your own reports, staff all" on public.issue_reports for select to authenticated
  using (reported_by = auth.uid() or private.is_staff());
create policy "staff close reports" on public.issue_reports for update to authenticated using (private.is_staff()) with check (private.is_staff());

create or replace function public.issue_reports_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.add_task('issue',
      (case new.kind when 'problem' then 'Problem reported' when 'question' then 'Question' else 'Idea' end)
        || ' from ' || coalesce(new.reporter_name, 'a user'),
      new.message || coalesce(E'\nPage: ' || new.page, ''),
      null, null, new.builder_id, 'issue_reports', new.id, now() + interval '1 day',
      case when new.kind = 'problem' then 'high' else 'normal' end);
    perform private.queue_team_email('Builder Listings: ' || new.kind || ' from ' || coalesce(new.reporter_name, 'a user'),
      new.message || coalesce(E'\n\nPage: ' || new.page, ''), 'issue_reports', new.id);
  elsif new.status = 'closed' and old.status <> 'closed' then
    perform private.close_tasks('issue_reports', new.id);
  end if;
  return new;
end $$;
revoke execute on function public.issue_reports_after() from public, anon, authenticated;
create trigger issue_reports_after after insert or update on public.issue_reports
  for each row execute function public.issue_reports_after();

create or replace function public.issue_reports_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select full_name, role::text, builder_id into new.reporter_name, new.reporter_role, new.builder_id
  from public.profiles where id = new.reported_by;
  return new;
end $$;
revoke execute on function public.issue_reports_fill() from public, anon, authenticated;
create trigger issue_reports_fill before insert on public.issue_reports for each row execute function public.issue_reports_fill();

-- ===========================================================================
-- Repeating open houses
-- ===========================================================================
create table public.open_house_series (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id),
  builder_id uuid not null references public.builders (id),
  weekday smallint not null check (weekday between 0 and 6),    -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  remarks text,
  until_date date,                                              -- null with until_under_contract = keep going
  until_under_contract boolean not null default false,
  created_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz not null default now(),
  constraint series_times check (end_time > start_time),
  constraint series_has_end check (until_date is not null or until_under_contract)
);
alter table public.open_houses add column series_id uuid references public.open_house_series (id);
create index open_house_series_active_idx on public.open_house_series (home_id) where ended_at is null;

alter table public.open_house_series enable row level security;
revoke all on public.open_house_series from anon;
create policy "see series on visible homes" on public.open_house_series for select to authenticated
  using (exists (select 1 from public.homes h where h.id = home_id));
create policy "schedule series" on public.open_house_series for insert to authenticated
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales')
              and exists (select 1 from public.homes h where h.id = home_id));
create policy "end series" on public.open_house_series for update to authenticated
  using (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales')
         and exists (select 1 from public.homes h where h.id = home_id))
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales'));

create or replace function public.open_house_series_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.builder_id := (select builder_id from public.homes where id = new.home_id);
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end $$;
revoke execute on function public.open_house_series_fill() from public, anon, authenticated;
create trigger open_house_series_fill before insert on public.open_house_series for each row execute function public.open_house_series_fill();

-- Create the open house dates the MLS window allows, and a task to enter them.
create or replace function private.extend_open_house_series(p_series uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  d date;
  window_days int := coalesce((select (value #>> '{}')::int from public.app_settings where key = 'mls_open_house_window_days'), 28);
  today date := (now() at time zone 'America/Chicago')::date;
  last_day date;
  added date[];
  total int := 0;
  addr text;
begin
  for s in
    select x.* from public.open_house_series x join public.homes h on h.id = x.home_id
    where x.ended_at is null and (p_series is null or x.id = p_series)
      and h.workflow_status = 'live_on_mls' and coalesce(h.market_status, 'active') = 'active'
  loop
    last_day := today + window_days;
    if s.until_date is not null and s.until_date < last_day then last_day := s.until_date; end if;
    added := '{}';
    d := today + ((s.weekday - extract(dow from today)::int + 7) % 7);
    while d <= last_day loop
      if (d::timestamp + s.start_time) at time zone 'America/Chicago' > now()
         and not exists (select 1 from public.open_houses o where o.series_id = s.id
                         and (o.starts_at at time zone 'America/Chicago')::date = d) then
        insert into public.open_houses (home_id, builder_id, created_by, starts_at, ends_at, remarks, series_id)
        values (s.home_id, s.builder_id, s.created_by,
                (d::timestamp + s.start_time) at time zone 'America/Chicago',
                (d::timestamp + s.end_time) at time zone 'America/Chicago',
                s.remarks, s.id);
        added := added || d;
      end if;
      d := d + 7;
    end loop;
    if s.until_date is not null and s.until_date <= today then
      update public.open_house_series set ended_at = now(), ended_reason = 'Reached the end date' where id = s.id;
    end if;
    if array_length(added, 1) > 0 then
      total := total + array_length(added, 1);
      select unparsed_address into addr from public.homes where id = s.home_id;
      perform private.add_task('open_house_mls',
        'Add ' || array_length(added, 1) || ' open house date' || case when array_length(added, 1) > 1 then 's' else '' end || ' to the MLS for ' || addr,
        'Repeating open house, ' || to_char(s.start_time, 'FMHH12:MI AM') || ' to ' || to_char(s.end_time, 'FMHH12:MI AM')
          || E'.\nDates: ' || (select string_agg(to_char(x, 'Dy Mon DD'), ', ') from unnest(added) x)
          || coalesce(E'\nNote for agents: ' || s.remarks, ''),
        s.home_id, null, null, 'open_house_series', s.id, now() + interval '1 day', 'normal');
    end if;
  end loop;
  return total;
end $$;
revoke execute on function private.extend_open_house_series(uuid) from public, anon, authenticated;

create or replace function public.open_house_series_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cancelled int;
begin
  if tg_op = 'INSERT' then
    perform private.extend_open_house_series(new.id);
    perform private.log_activity(new.home_id, 'open_house_series_started', jsonb_build_object('weekday', new.weekday));
  elsif new.ended_at is not null and old.ended_at is null then
    update public.open_houses set cancelled_at = now()
    where series_id = new.id and cancelled_at is null and starts_at > now();
    get diagnostics cancelled = row_count;
    if cancelled > 0 then
      perform private.add_task('open_house_mls',
        'Remove ' || cancelled || ' open house date' || case when cancelled > 1 then 's' else '' end || ' from the MLS for '
          || (select unparsed_address from public.homes where id = new.home_id),
        'The repeating open house ended: ' || coalesce(new.ended_reason, 'stopped by the builder') || '.',
        new.home_id, null, null, 'open_house_series_end', new.id, now() + interval '1 day', 'high');
    end if;
    perform private.log_activity(new.home_id, 'open_house_series_ended', jsonb_build_object('reason', new.ended_reason));
  end if;
  return new;
end $$;
revoke execute on function public.open_house_series_after() from public, anon, authenticated;
create trigger open_house_series_after after insert or update on public.open_house_series
  for each row execute function public.open_house_series_after();

-- Single open houses: a task to add (or remove) each one on the MLS.
create or replace function public.open_houses_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare addr text;
begin
  if new.series_id is not null then return new; end if;  -- series get one task per batch
  select unparsed_address into addr from public.homes where id = new.home_id;
  if tg_op = 'INSERT' then
    perform private.add_task('open_house_mls', 'Add an open house to the MLS for ' || addr,
      to_char(new.starts_at at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' to '
        || to_char(new.ends_at at time zone 'America/Chicago', 'FMHH12:MI AM') || coalesce(E'\nNote for agents: ' || new.remarks, ''),
      new.home_id, null, null, 'open_houses', new.id, least(new.starts_at, now() + interval '1 day'), 'normal');
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    if exists (select 1 from public.tasks where source_table = 'open_houses' and source_id = new.id and status in ('todo', 'in_progress')) then
      perform private.close_tasks('open_houses', new.id, null, 'cancelled');   -- never entered, nothing to remove
    else
      perform private.add_task('open_house_mls', 'Remove a cancelled open house from the MLS for ' || addr,
        to_char(new.starts_at at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM'),
        new.home_id, null, null, 'open_houses_cancel', new.id, now() + interval '1 day', 'high');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.open_houses_tasks() from public, anon, authenticated;
create trigger open_houses_tasks after insert or update on public.open_houses
  for each row execute function public.open_houses_tasks();

-- ===========================================================================
-- Tasks from listing changes
-- ===========================================================================
create or replace function public.homes_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  diff text[];
  open_task uuid;
  labels jsonb := '{"list_price":"price","bedrooms_total":"bedrooms","bathrooms_full":"full baths","bathrooms_half":"half baths",
    "living_area":"square feet","lot_size_acres":"lot size","public_remarks":"description","build_stage":"build stage",
    "estimated_completion":"completion date","unparsed_address":"address","plan_name":"plan","stories":"stories",
    "garage_spaces":"garage","year_built":"year built"}';
  status_text text;
begin
  -- Approved: our coordinator enters it into the MLS.
  if new.workflow_status = 'approved_for_mls' and old.workflow_status <> 'approved_for_mls' then
    perform private.add_task('mls_entry', 'Enter ' || new.unparsed_address || ' into the MLS',
      'Approved by the builder. Use the MLS entry sheet on the home page.', new.id, null, null, 'homes', new.id,
      now() + interval '1 day', 'high');
  end if;
  if old.workflow_status = 'approved_for_mls' and new.workflow_status <> 'approved_for_mls' then
    perform private.close_tasks('homes', new.id, 'mls_entry', case when new.workflow_status = 'live_on_mls' then 'done' else 'cancelled' end);
  end if;

  -- Live listing details changed: the MLS needs the same change.
  if new.workflow_status = 'live_on_mls' and old.workflow_status = 'live_on_mls' then
    select coalesce(array_agg(coalesce(labels ->> n.key, n.key)), '{}') into diff
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and labels ? n.key;
    if array_length(diff, 1) > 0 then
      select id into open_task from public.tasks
      where source_table = 'homes' and source_id = new.id and kind = 'mls_update' and status = 'todo' limit 1;
      if open_task is not null then
        update public.tasks set details = details || E'\n' || to_char(now() at time zone 'America/Chicago', 'Mon DD FMHH12:MI AM')
          || ': ' || array_to_string(diff, ', ') || ' changed', updated_at = now() where id = open_task;
      else
        perform private.add_task('mls_update', 'Update the MLS for ' || new.unparsed_address,
          to_char(now() at time zone 'America/Chicago', 'Mon DD FMHH12:MI AM') || ': ' || array_to_string(diff, ', ') || ' changed',
          new.id, null, null, 'homes', new.id, now() + interval '1 day', 'normal');
      end if;
    end if;
  end if;

  -- Market status changes: update the MLS; stop open houses when the home is off the market.
  if new.market_status is distinct from old.market_status and old.workflow_status = 'live_on_mls' then
    status_text := case new.market_status
      when 'active' then 'back to Active' when 'paused' then 'Temporarily Off Market (paused by the builder)'
      when 'under_contract' then 'Active Under Contract' when 'sold' then 'Closed (sold)'
      when 'withdrawn' then 'Withdrawn' else new.market_status end;
    perform private.add_task('listing_status', 'Change ' || new.unparsed_address || ' to ' || status_text || ' on the MLS',
      'Changed in Builder Listings by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'the builder') || '.',
      new.id, null, null, 'homes_status', new.id, now() + interval '1 day', 'high');
    if new.market_status in ('paused', 'under_contract', 'sold', 'withdrawn') then
      update public.open_house_series set ended_at = now(),
        ended_reason = 'the home is ' || case new.market_status when 'paused' then 'paused' when 'under_contract' then 'under contract'
          when 'sold' then 'sold' else 'withdrawn' end
      where home_id = new.id and ended_at is null;
      -- Single open houses too.
      update public.open_houses set cancelled_at = now()
      where home_id = new.id and series_id is null and cancelled_at is null and starts_at > now();
    end if;
    perform private.log_activity(new.id, 'market_' || new.market_status, '{}'::jsonb);
  end if;
  return new;
end $$;
revoke execute on function public.homes_tasks() from public, anon, authenticated;
create trigger homes_tasks after update on public.homes for each row execute function public.homes_tasks();

-- Change requests and photo requests become tasks for our team.
create or replace function public.change_requests_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.add_task('change_request', 'Change requested on ' || (select unparsed_address from public.homes where id = new.home_id),
      new.message, new.home_id, null, null, 'change_requests', new.id, now() + interval '2 days', 'normal');
  elsif new.status <> old.status and new.status in ('done', 'declined') then
    perform private.close_tasks('change_requests', new.id, null, case when new.status = 'done' then 'done' else 'cancelled' end);
  end if;
  return new;
end $$;
revoke execute on function public.change_requests_tasks() from public, anon, authenticated;
create trigger change_requests_tasks after insert or update on public.change_requests
  for each row execute function public.change_requests_tasks();

create or replace function public.media_requests_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.photographer_id is null then
    perform private.add_task('photo_request', 'Assign a photographer: ' || new.address,
      'Needs: ' || array_to_string(new.needs, ', ') || coalesce(E'\nDue: ' || to_char(new.due_date, 'Dy Mon DD'), '')
        || coalesce(E'\nNotes: ' || new.notes, ''),
      new.home_id, new.community_id, new.builder_id, 'media_requests', new.id,
      coalesce(new.due_date::timestamp at time zone 'America/Chicago' - interval '3 days', now() + interval '1 day'), 'normal');
  elsif tg_op = 'UPDATE' then
    if new.photographer_id is not null and old.photographer_id is null then
      perform private.close_tasks('media_requests', new.id);
    end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then
      perform private.close_tasks('media_requests', new.id, null, 'cancelled');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.media_requests_tasks() from public, anon, authenticated;
create trigger media_requests_tasks after insert or update on public.media_requests
  for each row execute function public.media_requests_tasks();

-- ===========================================================================
-- Daily: add the next open house dates as the MLS window moves forward.
-- ===========================================================================
create extension if not exists pg_cron;
select cron.schedule('extend-open-house-series', '17 11 * * *', $$select private.extend_open_house_series()$$);
