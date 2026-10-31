-- Broker work orders (owners, 30 Oct 2026, from Matt's "Broker Work Orders"
-- write-up). Builds on broker mode (migrations 066-067):
--
--  1. Work order numbers: every task gets a short number (WO-1001...), shown
--     next to the address so a home's new listing and its later updates can be
--     told apart.
--  2. Per-listing broker: a home can be given to one of the builder's brokers
--     (homes.broker_id). Blank = every broker the builder has (as before).
--  3. Send back with corrections: the broker flags fields (with the value they
--     think is right) or photos (with a note) instead of entering. The builder
--     answers each one and resends the same work order.
--  4. Builder accepts before a work order closes: the broker's "done" (and the
--     MLS number + a link to the live listing on a new one) becomes
--     "submitted"; the builder checks it and accepts (or sends it back).
--  5. A link to the live MLS listing (homes.mls_listing_url).
--  6. A log of what the broker looked at and did (broker_activity).
--  7. One-off links: a single work order for a broker without an account,
--     working until that work order is done (owners' choice) or turned off.
--     Owners approved this as a fourth signed-out page (/w/[token]).
-- Our team and builders who enter their own listings are unchanged: nothing
-- here applies outside broker mode.

-- ---------------------------------------------------------------------------
-- 1. Work order numbers and the "submitted" step
-- ---------------------------------------------------------------------------
create sequence public.tasks_work_order_seq start 1001;
alter table public.tasks add column work_order_no bigint;
update public.tasks t set work_order_no = s.n
from (select id, 1000 + row_number() over (order by created_at, id) as n from public.tasks) s where t.id = s.id;
select setval('public.tasks_work_order_seq', (select coalesce(max(work_order_no), 1000) + 1 from public.tasks), false);
alter table public.tasks alter column work_order_no set default nextval('public.tasks_work_order_seq');
alter table public.tasks alter column work_order_no set not null;
create unique index tasks_work_order_no_key on public.tasks (work_order_no);
grant usage, select on sequence public.tasks_work_order_seq to authenticated, service_role;

-- "submitted": the broker says it's done; waiting for the builder to accept.
alter table public.tasks drop constraint tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('todo', 'in_progress', 'submitted', 'done', 'cancelled'));
alter table public.tasks
  add column submitted_at timestamptz,
  add column submitted_by_name text,
  add column submitted_mls_number text,
  add column submitted_mls_url text;

-- Closing a task's source also closes a submitted one (e.g. the builder takes
-- an approved home back for changes while the broker's entry waits).
create or replace function private.close_tasks(p_source_table text, p_source_id uuid, p_kind text default null, p_status text default 'done')
returns void language sql security definer set search_path = '' as $$
  update public.tasks set status = p_status
  where source_table = p_source_table and source_id = p_source_id
    and (p_kind is null or kind = p_kind) and status in ('todo', 'in_progress', 'submitted')
$$;
revoke execute on function private.close_tasks(text, uuid, text, text) from public, anon, authenticated;

-- Notes left through a one-off link have no login; they carry a name instead.
alter table public.task_notes add column author_name text;

-- ---------------------------------------------------------------------------
-- 2. The home: its broker and its live MLS link
-- ---------------------------------------------------------------------------
alter table public.homes
  add column broker_id uuid references public.profiles (id),
  add column mls_listing_url text check (mls_listing_url is null or (mls_listing_url ~* '^https?://' and length(mls_listing_url) <= 500));

-- Who at the builder checks a broker's work and manages their brokers' jobs:
-- the owner, managers and marketing, and our staff for that builder.
create or replace function private.can_review_broker_work(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(b is not null and (private.staff_for(b)
    or (private.my_builder_id() = b and private.my_role() in ('builder_owner', 'manager', 'marketing'))), false)
$$;
revoke all on function private.can_review_broker_work(uuid) from public, anon;
grant execute on function private.can_review_broker_work(uuid) to authenticated;

-- Is this person an active broker the builder currently works with?
create or replace function private.broker_active_for(p_broker uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.broker_builders l join public.profiles p on p.id = l.broker_id
    where l.broker_id = p_broker and l.builder_id = b and l.removed_at is null and p.is_active and p.role = 'broker'), false)
$$;
revoke all on function private.broker_active_for(uuid, uuid) from public, anon, authenticated;

-- May the signed-in broker see this home's work? Yes when the home has no
-- broker of its own, it's theirs, or its broker has since been removed.
create or replace function private.home_broker_ok(p_home uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select h.broker_id is null or h.broker_id = (select auth.uid())
                     or not private.broker_active_for(h.broker_id, h.builder_id)
                   from public.homes h where h.id = p_home), true)
$$;
revoke all on function private.home_broker_ok(uuid) from public, anon, authenticated;

-- Pick which of the builder's brokers lists this home (null = any of them).
create or replace function public.set_home_broker(p_home uuid, p_broker uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare h public.homes;
begin
  select * into h from public.homes where id = p_home and deleted_at is null;
  if h.id is null or not private.can_review_broker_work(h.builder_id) then
    raise exception 'That home wasn''t found' using errcode = '42501';
  end if;
  if p_broker is not null and not private.broker_active_for(p_broker, h.builder_id) then
    raise exception 'Pick one of your current brokers' using errcode = '22023';
  end if;
  if h.broker_id is not distinct from p_broker then return; end if;
  perform set_config('app.system_update', 'on', true);
  update public.homes set broker_id = p_broker where id = h.id;
  perform set_config('app.system_update', 'off', true);
  insert into public.broker_activity (builder_id, home_id, actor_id, who, action, detail)
  values (h.builder_id, h.id, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'Someone'), 'assigned',
          jsonb_build_object('broker', (select full_name from public.profiles where id = p_broker)));
end $$;
revoke all on function public.set_home_broker(uuid, uuid) from public, anon;
grant execute on function public.set_home_broker(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What the broker looked at and did
-- ---------------------------------------------------------------------------
create table public.broker_activity (
  id bigint generated always as identity primary key,
  builder_id uuid not null references public.builders (id),
  home_id uuid references public.homes (id),
  task_id uuid references public.tasks (id) on delete cascade,
  actor_id uuid references auth.users (id),
  link_id uuid,
  who text not null,
  action text not null check (action in ('viewed', 'sent_back', 'submitted', 'note', 'took_back',
                                         'accepted', 'returned', 'answered', 'resent', 'assigned', 'link_made', 'link_off')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index broker_activity_home_idx on public.broker_activity (home_id, created_at desc);
create index broker_activity_task_idx on public.broker_activity (task_id, created_at desc);
alter table public.broker_activity enable row level security;
-- Seen by the builder's owner, managers and marketing, and our staff for that builder.
-- Written only by the functions below.
create policy "see broker activity" on public.broker_activity for select to authenticated
  using (private.can_review_broker_work(builder_id));

create or replace function private.broker_log(t public.tasks, p_action text, p_who text, p_link uuid, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Views are kept once per half hour per person and work order, so the log stays readable.
  if p_action = 'viewed' and exists (select 1 from public.broker_activity a
       where a.task_id = t.id and a.action = 'viewed' and a.created_at > now() - interval '30 minutes'
         and a.actor_id is not distinct from auth.uid() and a.link_id is not distinct from p_link) then
    return;
  end if;
  insert into public.broker_activity (builder_id, home_id, task_id, actor_id, link_id, who, action, detail)
  values (t.builder_id, t.home_id, t.id, auth.uid(), p_link, p_who, p_action, coalesce(p_detail, '{}'));
end $$;
revoke all on function private.broker_log(public.tasks, text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Corrections the broker sends back
-- ---------------------------------------------------------------------------
create table public.broker_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  builder_id uuid not null references public.builders (id),
  home_id uuid references public.homes (id),
  kind text not null check (kind in ('field', 'photo')),
  field_key text,
  field_label text,
  current_text text,
  proposed_text text,
  media_id uuid references public.media (id),
  note text,
  status text not null default 'open' check (status in ('open', 'accepted', 'changed', 'declined')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  created_by_name text not null,
  link_id uuid,
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  decision_note text,
  resent_at timestamptz,
  check ((kind = 'field' and field_key is not null and field_label is not null) or (kind = 'photo' and media_id is not null))
);
create index broker_requests_task_idx on public.broker_requests (task_id, created_at);
create index broker_requests_home_idx on public.broker_requests (home_id) where status = 'open';
alter table public.broker_requests enable row level security;
create policy "see broker requests" on public.broker_requests for select to authenticated
  using (private.can_review_broker_work(builder_id));

-- ---------------------------------------------------------------------------
-- 5. One-off links (a single work order, no account)
-- ---------------------------------------------------------------------------
create table public.broker_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_'),
  task_id uuid not null references public.tasks (id) on delete cascade,
  builder_id uuid not null references public.builders (id),
  home_id uuid references public.homes (id),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  opened_count int not null default 0,
  last_opened_at timestamptz
);
create index broker_links_task_idx on public.broker_links (task_id);
alter table public.broker_links enable row level security;
create policy "see broker links for work orders" on public.broker_links for select to authenticated
  using (private.can_review_broker_work(builder_id));

alter table public.broker_activity add constraint broker_activity_link_fk foreign key (link_id) references public.broker_links (id);
alter table public.broker_requests add constraint broker_requests_link_fk foreign key (link_id) references public.broker_links (id);

-- The live work order behind a one-off link, or nothing.
create or replace function private.link_task(p_token text) returns public.tasks
language sql stable security definer set search_path = '' as $$
  select t.* from public.broker_links l join public.tasks t on t.id = l.task_id
  where l.token = p_token and l.revoked_at is null and private.is_mls_task(t.kind)
    and t.status not in ('done', 'cancelled') and private.broker_mode(t.builder_id)
$$;
revoke all on function private.link_task(text) from public, anon, authenticated;

create or replace function private.link_row(p_token text) returns public.broker_links
language sql stable security definer set search_path = '' as $$
  select l.* from public.broker_links l where l.token = p_token and l.revoked_at is null
$$;
revoke all on function private.link_row(text) from public, anon, authenticated;

-- A one-off link for one open work order.
create or replace function public.make_broker_link(p_task uuid, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; tok text; lid uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not private.is_mls_task(t.kind) or not private.can_review_broker_work(t.builder_id)
     or not private.broker_mode(t.builder_id) then
    raise exception 'That work order wasn''t found' using errcode = '42501';
  end if;
  if t.status in ('done', 'cancelled') then raise exception 'That work order is finished' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter who the link is for' using errcode = '22023'; end if;
  insert into public.broker_links (task_id, builder_id, home_id, name, created_by)
  values (t.id, t.builder_id, t.home_id, trim(p_name), auth.uid()) returning token, id into tok, lid;
  perform private.broker_log(t, 'link_made', coalesce((select full_name from public.profiles where id = auth.uid()), 'Someone'), null,
    jsonb_build_object('for', trim(p_name)));
  return tok;
end $$;
revoke all on function public.make_broker_link(uuid, text) from public, anon;
grant execute on function public.make_broker_link(uuid, text) to authenticated;

create or replace function public.turn_off_broker_link(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.broker_links; t public.tasks;
begin
  select * into l from public.broker_links where id = p_link;
  if l.id is null or not private.can_review_broker_work(l.builder_id) then
    raise exception 'That link wasn''t found' using errcode = '42501';
  end if;
  if l.revoked_at is not null then return; end if;
  update public.broker_links set revoked_at = now(), revoked_by = auth.uid() where id = l.id;
  select * into t from public.tasks where id = l.task_id;
  perform private.broker_log(t, 'link_off', coalesce((select full_name from public.profiles where id = auth.uid()), 'Someone'), null,
    jsonb_build_object('for', l.name));
end $$;
revoke all on function public.turn_off_broker_link(uuid) from public, anon;
grant execute on function public.turn_off_broker_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Who the broker is (signed in, or through a one-off link)
-- ---------------------------------------------------------------------------

-- A signed-in broker may work this task (now also checks the home's own broker).
create or replace function private.broker_task(p_task uuid) returns public.tasks
language sql stable security definer set search_path = '' as $$
  select t.* from public.tasks t
  where t.id = p_task and private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
    and (t.home_id is null or private.home_broker_ok(t.home_id))
$$;
revoke all on function private.broker_task(uuid) from public, anon, authenticated;

create or replace function private.my_broker_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(full_name), ''), 'Your broker') from public.profiles where id = auth.uid()
$$;
revoke all on function private.my_broker_name() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The work sheet (shared by both ways in)
-- ---------------------------------------------------------------------------
create or replace function private.broker_sheet_json(t public.tasks) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.homes; res jsonb; photo_ids uuid[];
begin
  select * into h from public.homes where id = t.home_id and deleted_at is null;

  res := jsonb_build_object(
    'task', jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'details', t.details, 'status', t.status,
      'priority', t.priority, 'due_at', t.due_at, 'created_at', t.created_at, 'completed_at', t.completed_at,
      'changes', t.changes, 'checked', t.checked, 'source_table', t.source_table, 'source_id', t.source_id, 'home_id', t.home_id,
      'work_order_no', t.work_order_no, 'submitted_at', t.submitted_at, 'submitted_by_name', t.submitted_by_name,
      'submitted_mls_number', t.submitted_mls_number, 'submitted_mls_url', t.submitted_mls_url),
    'builder_name', (select replace(name, ' (demo)', '') from public.builders where id = t.builder_id),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at,
                 'mine', n.author_id is not null and n.author_id = auth.uid(),
                 'author', case when n.author_id is not null and n.author_id = auth.uid() then 'You'
                                when n.author_name is not null then n.author_name
                                when p.role = 'broker' then p.full_name
                                when p.builder_id is not null then coalesce(p.full_name, 'The builder')
                                else 'Builder Listings team' end) order by n.created_at)
               from public.task_notes n left join public.profiles p on p.id = n.author_id where n.task_id = t.id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'field_key', r.field_key, 'field_label', r.field_label,
                 'current_text', r.current_text, 'proposed_text', r.proposed_text, 'media_id', r.media_id, 'note', r.note,
                 'status', r.status, 'decision_note', r.decision_note, 'created_at', r.created_at, 'decided_at', r.decided_at,
                 'resent_at', r.resent_at, 'created_by_name', r.created_by_name) order by r.created_at)
               from public.broker_requests r where r.task_id = t.id), '[]'::jsonb));

  if h.id is not null then
    res := res || jsonb_build_object(
      -- The home, minus internal bookkeeping the MLS doesn't need.
      'home', (to_jsonb(h) - array['field_sources', 'updated_by', 'website_page_url', 'approved_at', 'live_at',
                                   'market_status_at', 'availability_confirmed_at', 'created_at', 'deleted_at', 'broker_id'])
              || jsonb_build_object(
                   'builders', (select jsonb_build_object('name', b.name, 'legal_name', b.legal_name) from public.builders b where b.id = h.builder_id),
                   'communities', (select jsonb_build_object('name', c.name, 'county', c.county, 'mls_fields', c.mls_fields)
                                   from public.communities c where c.id = h.community_id)),
      'mls_rows', coalesce((select jsonb_agg(jsonb_build_object('home_id', d.home_id, 'community_id', d.community_id, 'data', d.data))
                            from public.mls_details d where d.home_id = h.id or d.community_id = h.community_id), '[]'::jsonb),
      'board', (select jsonb_build_object('code', b.code, 'name', b.name, 'short_name', b.short_name, 'region', b.region,
                  'counties', b.counties, 'rules', b.rules, 'field_rules', b.field_rules, 'extra_fields', b.extra_fields)
                from public.mls_boards b where b.code = h.mls_board),
      'title', (select jsonb_build_object('title_company_name', s.title_company_name, 'title_company_location', s.title_company_location,
                  'title_company_phone', s.title_company_phone, 'title_company_contact', null, 'title_company_email', null)
                from public.builder_settings s where s.builder_id = h.builder_id),
      'listing', coalesce((select jsonb_agg(jsonb_build_object('id', lm.id, 'position', lm.position,
                   'media', (select private.broker_media_json(m) from public.media m where m.id = lm.media_id and m.deleted_at is null),
                   'tour', (select jsonb_build_object('id', v.id, 'home_id', v.home_id, 'community_id', v.community_id, 'provider', v.provider,
                              'url', v.url, 'branded', v.branded, 'title', v.title, 'added_by_role', v.added_by_role, 'created_at', v.created_at)
                            from public.virtual_tours v where v.id = lm.tour_id and v.deleted_at is null)) order by lm.position)
                 from public.listing_media lm where lm.home_id = h.id), '[]'::jsonb),
      'incentives', coalesce((select jsonb_agg(to_jsonb(i) - array['created_by', 'updated_by', 'ended_by'])
                   from public.home_incentives(h.id) i), '[]'::jsonb));
  end if;

  select coalesce(array_agg(x::uuid), '{}') into photo_ids
  from jsonb_array_elements_text(coalesce(t.changes -> 'photos' -> 'added', '[]') || coalesce(t.changes -> 'photos' -> 'removed', '[]')) x;
  if array_length(photo_ids, 1) > 0 then
    res := res || jsonb_build_object('change_media', coalesce((select jsonb_agg(private.broker_media_json(m))
             from public.media m where m.id = any (photo_ids) and m.builder_id = t.builder_id), '[]'::jsonb));
  end if;

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
revoke all on function private.broker_sheet_json(public.tasks) from public, anon, authenticated;

-- Signed-in broker: the sheet (now also logs the visit, so not "stable").
drop function public.broker_task_sheet(uuid);
create function public.broker_task_sheet(p_task uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then return null; end if;
  perform private.broker_log(t, 'viewed', private.my_broker_name(), null);
  return private.broker_sheet_json(t);
end $$;
revoke all on function public.broker_task_sheet(uuid) from public, anon;
grant execute on function public.broker_task_sheet(uuid) to authenticated;

-- One-off link: the same sheet, plus who the link is for.
create or replace function public.broker_link_sheet(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; l public.broker_links;
begin
  l := private.link_row(p_token);
  t := private.link_task(p_token);
  if t.id is null or l.id is null then return null; end if;
  update public.broker_links set opened_count = opened_count + 1, last_opened_at = now() where id = l.id;
  perform private.broker_log(t, 'viewed', l.name || ' (one-off link)', l.id);
  return private.broker_sheet_json(t) || jsonb_build_object('link', jsonb_build_object('name', l.name));
end $$;
revoke all on function public.broker_link_sheet(text) from public;
grant execute on function public.broker_link_sheet(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The broker's actions, shared by both ways in
-- ---------------------------------------------------------------------------

-- Tell the builder's owner, managers and marketing (inbox) and owner and marketing (email).
create or replace function private.tell_builder(t public.tasks, p_subject text, p_body text, p_anchor text default 'broker')
returns void language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform private.notify_builder(t.builder_id, array['builder_owner', 'manager', 'marketing'], t.community_id, 'mls',
    p_subject, p_body, coalesce('/homes/' || t.home_id || '#' || p_anchor, '/communities'));
  for p in select id from public.profiles where builder_id = t.builder_id and is_active and role in ('builder_owner', 'marketing') loop
    perform private.queue_email_to(p.id, p_subject, p_body, 'tasks', t.id);
  end loop;
end $$;
revoke all on function private.tell_builder(public.tasks, text, text, text) from public, anon, authenticated;

-- Tell the broker(s) on a work order: the home's own broker, else every active broker of the builder.
create or replace function private.tell_brokers(t public.tasks, p_subject text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare p record; hb uuid;
begin
  select broker_id into hb from public.homes where id = t.home_id;
  for p in select l.broker_id from public.broker_builders l join public.profiles pr on pr.id = l.broker_id
           where l.builder_id = t.builder_id and l.removed_at is null and pr.is_active and pr.role = 'broker'
             and (hb is null or not private.broker_active_for(hb, t.builder_id) or l.broker_id = hb) loop
    perform private.queue_email_to(p.broker_id, p_subject, p_body, 'tasks', t.id);
  end loop;
end $$;
revoke all on function private.tell_brokers(public.tasks, text, text) from public, anon, authenticated;

create or replace function private.wo_label(t public.tasks) returns text
language sql stable security definer set search_path = '' as $$
  select 'WO-' || t.work_order_no || ' · ' || coalesce((select unparsed_address from public.homes where id = t.home_id), t.title)
$$;
revoke all on function private.wo_label(public.tasks) from public, anon, authenticated;

create or replace function private.broker_toggle(t public.tasks, p_item text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if t.status in ('done', 'submitted') then raise exception 'That work order is finished' using errcode = '22023'; end if;
  if length(coalesce(p_item, '')) not between 1 and 200 then raise exception 'Unknown line' using errcode = '22023'; end if;
  update public.tasks set checked = case
      when p_on then (select array_agg(distinct x) from unnest(checked || p_item) x)
      else array_remove(checked, p_item) end
  where id = t.id;
end $$;
revoke all on function private.broker_toggle(public.tasks, text, boolean) from public, anon, authenticated;

create or replace function private.broker_note(t public.tasks, p_body text, p_who text, p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b text := trim(coalesce(p_body, ''));
begin
  if b = '' or length(b) > 2000 then raise exception 'Write a note first (up to 2,000 characters)' using errcode = '22023'; end if;
  insert into public.task_notes (task_id, author_id, author_name, body)
  values (t.id, auth.uid(), case when p_link is not null then p_who end, b);
  perform private.broker_log(t, 'note', p_who, p_link, jsonb_build_object('body', left(b, 300)));
  perform private.tell_builder(t, 'Note from your broker: ' || private.wo_label(t), p_who || ': ' || b);
end $$;
revoke all on function private.broker_note(public.tasks, text, text, uuid) from public, anon, authenticated;

-- Send the work order back with corrections. p_items is a list of
--   {"kind":"field","key":"LivingArea","label":"SqFt/Living Area","current":"2145","proposed":"2,154","note":"..."}
--   {"kind":"photo","media_id":"...","note":"blurry"}
create or replace function private.broker_send_back(t public.tasks, p_items jsonb, p_note text, p_who text, p_link uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare it jsonb; n int := 0; lines text := ''; mid uuid; nt text := nullif(trim(coalesce(p_note, '')), '');
begin
  if t.status in ('done', 'submitted') then raise exception 'That work order is finished' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception 'Flag at least one field or photo' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'Too many at once (60 at most)' using errcode = '22023'; end if;
  if length(coalesce(nt, '')) > 2000 then raise exception 'That note is too long' using errcode = '22023'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if it ->> 'kind' = 'field' then
      if coalesce(it ->> 'key', '') = '' or length(it ->> 'key') > 100 or coalesce(it ->> 'label', '') = '' then
        raise exception 'Pick a field' using errcode = '22023';
      end if;
      if coalesce(trim(it ->> 'proposed'), '') = '' and coalesce(trim(it ->> 'note'), '') = '' then
        raise exception 'Say what % should be, or why', it ->> 'label' using errcode = '22023';
      end if;
      insert into public.broker_requests (task_id, builder_id, home_id, kind, field_key, field_label, current_text, proposed_text, note, created_by, created_by_name, link_id)
      values (t.id, t.builder_id, t.home_id, 'field', it ->> 'key', left(it ->> 'label', 200), left(it ->> 'current', 2000),
              nullif(left(trim(coalesce(it ->> 'proposed', '')), 2000), ''), nullif(left(trim(coalesce(it ->> 'note', '')), 1000), ''),
              auth.uid(), p_who, p_link);
      lines := lines || E'\n- ' || (it ->> 'label') || coalesce(': should be ' || nullif(trim(it ->> 'proposed'), ''), '')
               || coalesce(' (' || nullif(trim(it ->> 'note'), '') || ')', '');
    elsif it ->> 'kind' = 'photo' then
      mid := (it ->> 'media_id')::uuid;
      if mid is null or mid not in (select private.broker_task_media(t)) then raise exception 'That photo isn''t on this work order' using errcode = '22023'; end if;
      if coalesce(trim(it ->> 'note'), '') = '' then raise exception 'Say what''s wrong with the photo' using errcode = '22023'; end if;
      insert into public.broker_requests (task_id, builder_id, home_id, kind, media_id, note, created_by, created_by_name, link_id)
      values (t.id, t.builder_id, t.home_id, 'photo', mid, left(trim(it ->> 'note'), 1000), auth.uid(), p_who, p_link);
      lines := lines || E'\n- Photo: ' || trim(it ->> 'note');
    else
      raise exception 'Unknown item' using errcode = '22023';
    end if;
    n := n + 1;
  end loop;
  if nt is not null then
    insert into public.task_notes (task_id, author_id, author_name, body) values (t.id, auth.uid(), case when p_link is not null then p_who end, nt);
  end if;
  perform private.broker_log(t, 'sent_back', p_who, p_link, jsonb_build_object('count', n));
  perform private.tell_builder(t, 'Your broker sent back ' || private.wo_label(t),
    p_who || ' needs ' || case when n = 1 then 'one thing' else n || ' things' end || ' checked before entering it on the MLS:' || lines
    || coalesce(E'\n\n' || nt, '') || E'\n\nAnswer each one on the home''s page (Your broker), then resend it.');
  return n;
end $$;
revoke all on function private.broker_send_back(public.tasks, jsonb, text, text, uuid) from public, anon, authenticated;

-- The broker's "done": submitted for the builder to check and accept.
-- A new listing needs its MLS number and a link to the live listing.
create or replace function private.broker_submit(t public.tasks, p_mls text, p_url text, p_who text, p_link uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare n text := trim(coalesce(p_mls, '')); u text := trim(coalesce(p_url, ''));
begin
  if t.status in ('done', 'submitted') then raise exception 'That work order is already finished' using errcode = '22023'; end if;
  if exists (select 1 from public.broker_requests where task_id = t.id and resent_at is null) then
    raise exception 'This work order is waiting on the builder''s answers' using errcode = '22023';
  end if;
  if t.kind = 'mls_entry' then
    if n = '' or length(n) > 40 then raise exception 'Enter the MLS number the MLS gave this listing' using errcode = '22023'; end if;
    if u !~* '^https?://' or length(u) > 500 then raise exception 'Paste the link to the live listing (starting with https://)' using errcode = '22023'; end if;
    if not exists (select 1 from public.homes where id = t.home_id and workflow_status = 'approved_for_mls' and deleted_at is null) then
      raise exception 'This home isn''t waiting to go on the MLS any more' using errcode = '22023';
    end if;
  else
    if u <> '' and (u !~* '^https?://' or length(u) > 500) then raise exception 'That link should start with https://' using errcode = '22023'; end if;
  end if;
  update public.tasks set status = 'submitted', submitted_at = now(), submitted_by_name = p_who,
    submitted_mls_number = nullif(n, ''), submitted_mls_url = nullif(u, '')
  where id = t.id;
  perform private.broker_log(t, 'submitted', p_who, p_link, jsonb_build_object('mls_number', nullif(n, ''), 'url', nullif(u, '')));
end $$;
revoke all on function private.broker_submit(public.tasks, text, text, text, uuid) from public, anon, authenticated;

-- Signed-in broker wrappers.
create or replace function public.broker_toggle_check(p_task uuid, p_item text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  perform private.broker_toggle(t, p_item, p_on);
end $$;

create or replace function public.broker_add_note(p_task uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  perform private.broker_note(t, p_body, private.my_broker_name(), null);
end $$;

create or replace function public.broker_send_back(p_task uuid, p_items jsonb, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  return private.broker_send_back(t, p_items, p_note, private.my_broker_name(), null);
end $$;
revoke all on function public.broker_send_back(uuid, jsonb, text) from public, anon;
grant execute on function public.broker_send_back(uuid, jsonb, text) to authenticated;

create or replace function public.broker_submit(p_task uuid, p_mls text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  perform private.broker_submit(t, p_mls, p_url, private.my_broker_name(), null);
end $$;
revoke all on function public.broker_submit(uuid, text, text) from public, anon;
grant execute on function public.broker_submit(uuid, text, text) to authenticated;

-- Start, or take back a submitted one (before the builder accepts). Finishing
-- is broker_submit now.
create or replace function public.broker_set_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if p_status not in ('todo', 'in_progress') then raise exception 'Use "Send to the builder" to finish' using errcode = '22023'; end if;
  if t.status = 'done' then raise exception 'That work order is closed' using errcode = '22023'; end if;
  update public.tasks set status = p_status, submitted_at = null, submitted_by_name = null, submitted_mls_number = null, submitted_mls_url = null
  where id = t.id;
  if t.status = 'submitted' then perform private.broker_log(t, 'took_back', private.my_broker_name(), null); end if;
end $$;

-- The old one-step "mark live" now submits for the builder to accept.
create or replace function public.broker_mark_live(p_task uuid, p_mls text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Enter the MLS number and the link to the live listing, then send it to the builder' using errcode = '22023';
end $$;

-- One-off link wrappers (signed out).
create or replace function public.broker_link_toggle(p_token text, p_item text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.link_task(p_token);
  if t.id is null then raise exception 'This link has expired or was turned off' using errcode = '42501'; end if;
  perform private.broker_toggle(t, p_item, p_on);
end $$;
revoke all on function public.broker_link_toggle(text, text, boolean) from public;
grant execute on function public.broker_link_toggle(text, text, boolean) to anon, authenticated;

create or replace function public.broker_link_note(p_token text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; l public.broker_links;
begin
  t := private.link_task(p_token); l := private.link_row(p_token);
  if t.id is null then raise exception 'This link has expired or was turned off' using errcode = '42501'; end if;
  perform private.broker_note(t, p_body, l.name, l.id);
end $$;
revoke all on function public.broker_link_note(text, text) from public;
grant execute on function public.broker_link_note(text, text) to anon, authenticated;

create or replace function public.broker_link_send_back(p_token text, p_items jsonb, p_note text) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; l public.broker_links;
begin
  t := private.link_task(p_token); l := private.link_row(p_token);
  if t.id is null then raise exception 'This link has expired or was turned off' using errcode = '42501'; end if;
  return private.broker_send_back(t, p_items, p_note, l.name, l.id);
end $$;
revoke all on function public.broker_link_send_back(text, jsonb, text) from public;
grant execute on function public.broker_link_send_back(text, jsonb, text) to anon, authenticated;

create or replace function public.broker_link_submit(p_token text, p_mls text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; l public.broker_links;
begin
  t := private.link_task(p_token); l := private.link_row(p_token);
  if t.id is null then raise exception 'This link has expired or was turned off' using errcode = '42501'; end if;
  perform private.broker_submit(t, p_mls, p_url, l.name, l.id);
end $$;
revoke all on function public.broker_link_submit(text, text, text) from public;
grant execute on function public.broker_link_submit(text, text, text) to anon, authenticated;

-- The work order behind a live link (so the app can send the emails it queued).
create or replace function public.broker_link_task_id(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select (private.link_task(p_token)).id
$$;
revoke all on function public.broker_link_task_id(text) from public;
grant execute on function public.broker_link_task_id(text) to anon, authenticated;

-- Files through a one-off link (same checks as a signed-in broker's).
create or replace function public.broker_link_file(p_token text, p_media uuid)
returns table (storage_path text, title text, source text, demo_key text, kind text, thumb_path text, web_path text)
language sql stable security definer set search_path = '' as $$
  select m.storage_path, m.title, m.source, m.demo_key, m.kind, m.thumb_path, m.web_path
  from public.media m, private.link_task(p_token) t
  where t.id is not null and m.id = p_media and m.deleted_at is null and m.builder_id = t.builder_id
    and m.id in (select private.broker_task_media(t))
$$;
revoke all on function public.broker_link_file(text, uuid) from public;
grant execute on function public.broker_link_file(text, uuid) to anon, authenticated;

-- Storage: signed-out visitors may make a private link only for files on a live one-off link's work order.
create or replace function share_access.broker_link_sees_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(exists (
    select 1 from public.broker_links l
    join public.tasks t on t.id = l.task_id
    join public.media m on m.builder_id = t.builder_id
    where l.revoked_at is null and private.is_mls_task(t.kind) and t.status not in ('done', 'cancelled') and private.broker_mode(t.builder_id)
      and (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name) and m.deleted_at is null
      and m.id in (select private.broker_task_media(t))), false)
$$;
revoke all on function share_access.broker_link_sees_file(text) from public;
grant execute on function share_access.broker_link_sees_file(text) to anon, authenticated;
create policy "media files: one-off broker links" on storage.objects for select to anon
  using (bucket_id = 'media' and share_access.broker_link_sees_file(name));

-- Signed-in broker files: also respect the home's own broker.
create or replace function private.broker_sees_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'broker' and exists (
    select 1 from public.media m
    join public.tasks t on t.builder_id = m.builder_id
    where (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name) and m.deleted_at is null
      and private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
      and (t.home_id is null or private.home_broker_ok(t.home_id))
      and m.id in (select private.broker_task_media(t))), false)
$$;

-- ---------------------------------------------------------------------------
-- 9. The builder's side: check and accept, send back, answer, resend
-- ---------------------------------------------------------------------------

create or replace function private.review_task(p_task uuid) returns public.tasks
language plpgsql stable security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not private.is_mls_task(t.kind) or not private.can_review_broker_work(t.builder_id) or not private.broker_mode(t.builder_id) then
    raise exception 'That work order wasn''t found' using errcode = '42501';
  end if;
  return t;
end $$;
revoke all on function private.review_task(uuid) from public, anon, authenticated;

create or replace function private.my_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(trim(full_name), '') from public.profiles where id = auth.uid()), 'The builder')
$$;
revoke all on function private.my_name() from public, anon, authenticated;

-- Accept the broker's result. A new listing goes live with the MLS number and link.
create or replace function public.accept_broker_work(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.review_task(p_task);
  if t.status <> 'submitted' then raise exception 'Your broker hasn''t sent this one back as done yet' using errcode = '22023'; end if;
  if t.kind = 'mls_entry' then
    if not exists (select 1 from public.homes where id = t.home_id and workflow_status = 'approved_for_mls' and deleted_at is null) then
      raise exception 'This home isn''t waiting to go on the MLS any more' using errcode = '22023';
    end if;
    perform set_config('app.system_update', 'on', true);
    update public.homes set workflow_status = 'live_on_mls', mls_number = t.submitted_mls_number, mls_listing_url = t.submitted_mls_url
    where id = t.home_id;
    perform set_config('app.system_update', 'off', true);
  elsif t.submitted_mls_url is not null then
    perform set_config('app.system_update', 'on', true);
    update public.homes set mls_listing_url = t.submitted_mls_url where id = t.home_id and workflow_status = 'live_on_mls';
    perform set_config('app.system_update', 'off', true);
  end if;
  update public.tasks set status = 'done' where id = t.id and status <> 'done';
  perform private.broker_log(t, 'accepted', private.my_name(), null);
  perform private.tell_brokers(t, 'Accepted: ' || private.wo_label(t),
    private.my_name() || ' checked it and accepted it. This work order is closed.');
end $$;
revoke all on function public.accept_broker_work(uuid) from public, anon;
grant execute on function public.accept_broker_work(uuid) to authenticated;

-- Not right yet: back to the broker with a note.
create or replace function public.return_broker_work(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; b text := trim(coalesce(p_note, ''));
begin
  t := private.review_task(p_task);
  if t.status <> 'submitted' then raise exception 'Only work your broker sent as done can go back' using errcode = '22023'; end if;
  if b = '' or length(b) > 2000 then raise exception 'Say what still needs fixing' using errcode = '22023'; end if;
  update public.tasks set status = 'in_progress', submitted_at = null where id = t.id;
  insert into public.task_notes (task_id, author_id, body) values (t.id, auth.uid(), b);
  perform private.broker_log(t, 'returned', private.my_name(), null, jsonb_build_object('note', left(b, 300)));
  perform private.tell_brokers(t, 'Not accepted yet: ' || private.wo_label(t), private.my_name() || E' says:\n\n' || b);
end $$;
revoke all on function public.return_broker_work(uuid, text) from public, anon;
grant execute on function public.return_broker_work(uuid, text) to authenticated;

-- Answer one correction: 'accepted' (changed it to the broker's value),
-- 'changed' (changed it some other way) or 'declined' (it's right as it is).
create or replace function public.answer_broker_request(p_request uuid, p_answer text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.broker_requests; t public.tasks;
begin
  select * into r from public.broker_requests where id = p_request;
  if r.id is null then raise exception 'That wasn''t found' using errcode = '42501'; end if;
  t := private.review_task(r.task_id);
  if p_answer not in ('accepted', 'changed', 'declined') then raise exception 'Unknown answer' using errcode = '22023'; end if;
  if r.resent_at is not null then raise exception 'That was already sent back to your broker' using errcode = '22023'; end if;
  if p_answer = 'declined' and coalesce(trim(p_note), '') = '' then
    raise exception 'Tell your broker why it stays as it is' using errcode = '22023';
  end if;
  update public.broker_requests set status = p_answer, decided_at = now(), decided_by = auth.uid(),
    decision_note = nullif(left(trim(coalesce(p_note, '')), 1000), '')
  where id = r.id;
  perform private.broker_log(t, 'answered', private.my_name(), null, jsonb_build_object('item', coalesce(r.field_label, 'Photo'), 'answer', p_answer));
end $$;
revoke all on function public.answer_broker_request(uuid, text, text) from public, anon;
grant execute on function public.answer_broker_request(uuid, text, text) to authenticated;

-- Everything answered: send the same work order back to the broker.
create or replace function public.resend_to_broker(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; lines text := ''; r record; nt text := nullif(trim(coalesce(p_note, '')), '');
begin
  t := private.review_task(p_task);
  if not exists (select 1 from public.broker_requests where task_id = t.id and resent_at is null) then
    raise exception 'Nothing to send back' using errcode = '22023';
  end if;
  if exists (select 1 from public.broker_requests where task_id = t.id and resent_at is null and status = 'open') then
    raise exception 'Answer each one first' using errcode = '22023';
  end if;
  if length(coalesce(nt, '')) > 2000 then raise exception 'That note is too long' using errcode = '22023'; end if;
  for r in select * from public.broker_requests where task_id = t.id and resent_at is null order by created_at loop
    lines := lines || E'\n- ' || coalesce(r.field_label, 'Photo') || ': '
      || case r.status when 'accepted' then 'changed to your value' when 'changed' then 'changed' else 'left as it is' end
      || coalesce(' (' || r.decision_note || ')', '');
  end loop;
  update public.broker_requests set resent_at = now() where task_id = t.id and resent_at is null;
  update public.tasks set status = case when status = 'in_progress' then 'in_progress' else 'todo' end where id = t.id;
  if nt is not null then insert into public.task_notes (task_id, author_id, body) values (t.id, auth.uid(), nt); end if;
  perform private.broker_log(t, 'resent', private.my_name(), null);
  perform private.tell_brokers(t, 'Back to you: ' || private.wo_label(t),
    private.my_name() || ' answered what you sent back:' || lines || coalesce(E'\n\n' || nt, '') || E'\n\nOpen the work order to enter it.');
end $$;
revoke all on function public.resend_to_broker(uuid, text) from public, anon;
grant execute on function public.resend_to_broker(uuid, text) to authenticated;

-- A home's work orders for the builder's "Your broker" section.
create or replace function public.home_work_orders(p_home uuid)
returns table (id uuid, work_order_no bigint, kind text, title text, status text, created_at timestamptz, completed_at timestamptz,
               submitted_at timestamptz, submitted_by_name text, submitted_mls_number text, submitted_mls_url text,
               changes jsonb, open_requests int, waiting_requests int)
language sql stable security definer set search_path = '' as $$
  select t.id, t.work_order_no, t.kind, t.title, t.status, t.created_at, t.completed_at,
         t.submitted_at, t.submitted_by_name, t.submitted_mls_number, t.submitted_mls_url, t.changes,
         (select count(*)::int from public.broker_requests r where r.task_id = t.id and r.status = 'open'),
         (select count(*)::int from public.broker_requests r where r.task_id = t.id and r.resent_at is null)
  from public.tasks t join public.homes h on h.id = t.home_id
  where t.home_id = p_home and private.is_mls_task(t.kind) and t.status <> 'cancelled'
    and private.can_review_broker_work(h.builder_id) and private.broker_mode(h.builder_id)
  order by (t.status <> 'done') desc, t.created_at desc
  limit 50
$$;
revoke all on function public.home_work_orders(uuid) from public, anon;
grant execute on function public.home_work_orders(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The broker's dashboard: work orders and listings
-- ---------------------------------------------------------------------------
drop function public.broker_tasks();
create function public.broker_tasks()
returns table (id uuid, kind text, title text, status text, priority text, due_at timestamptz, created_at timestamptz,
               completed_at timestamptz, builder_name text, address text, mls_number text, work_order_no bigint,
               home_id uuid, waiting_on_builder int, submitted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.kind, t.title, t.status, t.priority, t.due_at, t.created_at, t.completed_at,
         replace(b.name, ' (demo)', ''), h.unparsed_address, h.mls_number, t.work_order_no, t.home_id,
         (select count(*)::int from public.broker_requests r where r.task_id = t.id and r.resent_at is null),
         t.submitted_at
  from public.tasks t
  join public.builders b on b.id = t.builder_id
  left join public.homes h on h.id = t.home_id
  where private.is_mls_task(t.kind) and t.status <> 'cancelled' and private.broker_for(t.builder_id)
    and (t.home_id is null or private.home_broker_ok(t.home_id))
  -- Open work first, oldest first, so nothing sits unnoticed.
  order by (t.status in ('todo', 'in_progress')) desc, (t.status = 'submitted') desc, t.created_at asc
  limit 400
$$;
revoke all on function public.broker_tasks() from public, anon;
grant execute on function public.broker_tasks() to authenticated;

-- Listings the broker works on: live ones and closed (sold or withdrawn) ones.
create or replace function public.broker_listings()
returns table (home_id uuid, address text, builder_name text, mls_number text, mls_listing_url text,
               workflow_status text, market_status text, last_work_at timestamptz, open_orders int)
language sql stable security definer set search_path = '' as $$
  select h.id, h.unparsed_address, replace(b.name, ' (demo)', ''), h.mls_number, h.mls_listing_url,
         h.workflow_status::text, coalesce(h.market_status::text, 'active'),
         (select max(t.created_at) from public.tasks t where t.home_id = h.id and private.is_mls_task(t.kind)),
         (select count(*)::int from public.tasks t where t.home_id = h.id and private.is_mls_task(t.kind) and t.status in ('todo', 'in_progress', 'submitted'))
  from public.homes h join public.builders b on b.id = h.builder_id
  where h.deleted_at is null and h.workflow_status = 'live_on_mls'
    and private.broker_for(h.builder_id) and private.home_broker_ok(h.id)
  order by h.unparsed_address
  limit 500
$$;
revoke all on function public.broker_listings() from public, anon;
grant execute on function public.broker_listings() to authenticated;

-- One listing's work order history.
create or replace function public.broker_listing(p_home uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'home', jsonb_build_object('id', h.id, 'address', h.unparsed_address, 'city', h.city, 'mls_number', h.mls_number,
       'mls_listing_url', h.mls_listing_url, 'workflow_status', h.workflow_status, 'market_status', coalesce(h.market_status::text, 'active'),
       'builder_name', (select replace(name, ' (demo)', '') from public.builders where id = h.builder_id)),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'work_order_no', t.work_order_no, 'kind', t.kind, 'title', t.title,
         'status', t.status, 'created_at', t.created_at, 'completed_at', t.completed_at, 'submitted_at', t.submitted_at) order by t.created_at desc)
       from public.tasks t where t.home_id = h.id and private.is_mls_task(t.kind) and t.status <> 'cancelled'), '[]'::jsonb))
  from public.homes h
  where h.id = p_home and h.deleted_at is null and private.broker_for(h.builder_id) and private.home_broker_ok(h.id)
$$;
revoke all on function public.broker_listing(uuid) from public, anon;
grant execute on function public.broker_listing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Notices
-- ---------------------------------------------------------------------------

-- New work: to the home's own broker when it has one, else every broker. The
-- subject carries the work order number.
create or replace function public.tasks_broker_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subject text; addr text; sent int := 0; hb uuid; p record;
begin
  if not private.is_mls_task(new.kind) or new.builder_id is null or not private.broker_mode(new.builder_id) then return null; end if;
  select unparsed_address, broker_id into addr, hb from public.homes where id = new.home_id;
  subject := case new.kind
    when 'mls_entry' then 'New listing to enter on the MLS: '
    when 'mls_update' then 'Update an MLS listing: '
    when 'open_house_mls' then 'Open house to put on the MLS: '
    else 'Listing status to change on the MLS: ' end
    || 'WO-' || new.work_order_no || ' · ' || coalesce(addr, new.title)
    || ' (' || (select replace(name, ' (demo)', '') from public.builders where id = new.builder_id) || ')';
  for p in select l.broker_id from public.broker_builders l join public.profiles pr on pr.id = l.broker_id
           where l.builder_id = new.builder_id and l.removed_at is null and pr.is_active and pr.role = 'broker'
             and (hb is null or not private.broker_active_for(hb, new.builder_id) or l.broker_id = hb) loop
    perform private.queue_email_to(p.broker_id, subject,
      coalesce(new.details || E'\n\n', '') || 'Sign in to Builder Listings to open the work order: every field to copy into the MLS, the photo pack, and a way to send it back if something looks wrong.'
        || case when new.due_at is not null then E'\n\nDue ' || to_char(new.due_at at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central.' else '' end,
      'tasks', new.id);
    sent := sent + 1;
  end loop;
  if sent = 0 then
    perform private.notify_builder(new.builder_id, array['builder_owner'], null, 'mls',
      'Add your listing broker: ' || coalesce(addr, new.title) || ' is waiting',
      'Your listings go to your own broker, but none is set up yet. Add them on the Team page, or send a one-off link from the home''s page.', '/team#broker');
  end if;
  return null;
end $$;
revoke all on function public.tasks_broker_notice() from public, anon, authenticated;

-- Submitted: the builder checks and accepts. Done without a submission (our
-- staff or the system closed it): the old "finished" notice.
create or replace function public.tasks_broker_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; subject text; body text;
begin
  if not private.is_mls_task(new.kind) or new.builder_id is null or not private.broker_mode(new.builder_id) then return null; end if;
  select unparsed_address, mls_number, mls_board into h from public.homes where id = new.home_id;
  if new.status = 'submitted' and old.status <> 'submitted' then
    subject := 'Check and accept: ' || private.wo_label(new);
    body := coalesce(new.submitted_by_name, 'Your broker') || ' says it''s done'
      || case when new.kind = 'mls_entry' then coalesce(': MLS #' || new.submitted_mls_number, '') || coalesce(E'\n' || new.submitted_mls_url, '') else '.' end
      || E'\n\nCheck it on the MLS, then accept it on the home''s page (Your broker). Nothing changes here until you do.';
    perform private.tell_builder(new, subject, body);
  elsif new.status = 'done' and old.status not in ('done', 'submitted') then
    subject := case new.kind
      when 'mls_entry' then 'Live on the MLS: ' || coalesce(h.unparsed_address, new.title) || coalesce(' (#' || h.mls_number || ')', '')
      when 'mls_update' then 'MLS listing updated: ' || coalesce(h.unparsed_address, new.title)
      when 'open_house_mls' then 'Open house updated on the MLS: ' || coalesce(h.unparsed_address, new.title)
      else 'MLS status changed: ' || coalesce(h.unparsed_address, new.title) end;
    body := case when new.kind = 'mls_entry' then 'It was entered on ' || coalesce(h.mls_board, 'the MLS') || coalesce(' as #' || h.mls_number, '') || '.'
                 else 'Finished: ' || new.title || '.' end;
    perform private.tell_builder(new, subject, body);
  end if;
  return null;
end $$;
revoke all on function public.tasks_broker_done() from public, anon, authenticated;

-- Grants for wrappers redefined above with create or replace keep their old
-- grants; set them again so a fresh build matches.
revoke all on function public.broker_toggle_check(uuid, text, boolean) from public, anon;
grant execute on function public.broker_toggle_check(uuid, text, boolean) to authenticated;
revoke all on function public.broker_add_note(uuid, text) from public, anon;
grant execute on function public.broker_add_note(uuid, text) to authenticated;
revoke all on function public.broker_set_status(uuid, text) from public, anon;
grant execute on function public.broker_set_status(uuid, text) to authenticated;
revoke all on function public.broker_mark_live(uuid, text) from public, anon;
grant execute on function public.broker_mark_live(uuid, text) to authenticated;
revoke all on function private.broker_sees_file(text) from public, anon;
grant execute on function private.broker_sees_file(text) to authenticated;
