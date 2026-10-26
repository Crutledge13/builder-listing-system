-- Listings go stale in predictable ways, and the MLS fines for some of them.
-- This adds alerts (for the builder, our team, or both), build-stage triggers,
-- fast sold detection, and an hourly compliance check.

-- ===========================================================================
-- When things happened (for reports and deadlines)
-- ===========================================================================
alter table public.homes
  add column approved_at timestamptz,
  add column live_at timestamptz,
  add column market_status_at timestamptz,
  add column availability_confirmed_at timestamptz;

-- System changes (e.g. taking the disclaimer off when real photos arrive) are
-- allowed past the role rules; only security-definer code sets this flag.
do $do$
declare src text;
begin
  src := pg_get_functiondef('public.enforce_home_edit_rules()'::regprocedure);
  src := replace(src, $x$  if auth.uid() is null then$x$,
    $x$  if auth.uid() is null or current_setting('app.system_update', true) = 'on' then$x$);
  execute src;
end $do$;

create or replace function private.system_update_on() returns void language plpgsql as $$ begin perform set_config('app.system_update', 'on', true); end $$;
create or replace function private.system_update_off() returns void language plpgsql as $$ begin perform set_config('app.system_update', 'off', true); end $$;
revoke execute on function private.system_update_on(), private.system_update_off() from public, anon, authenticated;

create or replace function public.homes_timestamps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workflow_status = 'approved_for_mls' and old.workflow_status is distinct from 'approved_for_mls' then new.approved_at := now(); end if;
  if new.workflow_status = 'live_on_mls' and old.workflow_status is distinct from 'live_on_mls' then
    new.live_at := now();
    new.availability_confirmed_at := now();
  end if;
  if new.market_status is distinct from old.market_status then new.market_status_at := now(); end if;
  return new;
end $$;
revoke execute on function public.homes_timestamps() from public, anon, authenticated;
create trigger homes_timestamps before update of workflow_status, market_status on public.homes
  for each row execute function public.homes_timestamps();

-- ===========================================================================
-- Alerts
-- ===========================================================================
create table public.home_alerts (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id),
  builder_id uuid not null references public.builders (id),
  community_id uuid references public.communities (id),
  kind text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'urgent')),
  audience text not null default 'both' check (audience in ('builder', 'team', 'both')),
  message text not null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  resolution text
);
create unique index home_alerts_one_open on public.home_alerts (home_id, kind) where resolved_at is null;
create index home_alerts_builder_open on public.home_alerts (builder_id) where resolved_at is null;
alter table public.home_alerts enable row level security;
revoke all on public.home_alerts from anon;
create policy "see alerts" on public.home_alerts for select to authenticated
  using (private.is_staff() or (audience <> 'team' and private.can_see_home(builder_id, community_id)));
create policy "staff resolve alerts" on public.home_alerts for update to authenticated
  using (private.is_staff()) with check (private.is_staff());

-- Open an alert (once) and email the builder's leads and salespeople if it's for them.
create or replace function private.raise_alert(p_home uuid, p_kind text, p_severity text, p_audience text, p_message text, p_due timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; aid uuid; existing record;
begin
  select id, builder_id, community_id, unparsed_address into h from public.homes where id = p_home;
  select id, severity, message into existing from public.home_alerts where home_id = p_home and kind = p_kind and resolved_at is null;
  if existing.id is not null then
    -- Escalate or reword an open alert without duplicating it.
    if existing.severity <> p_severity or existing.message <> p_message then
      update public.home_alerts set severity = p_severity, message = p_message, due_at = coalesce(p_due, due_at) where id = existing.id;
    end if;
    return existing.id;
  end if;
  insert into public.home_alerts (home_id, builder_id, community_id, kind, severity, audience, message, due_at)
  values (p_home, h.builder_id, h.community_id, p_kind, p_severity, p_audience, p_message, p_due)
  returning id into aid;
  if p_audience in ('builder', 'both') then
    insert into public.email_outbox (to_email, subject, body, related_table, related_id)
    select p.email, 'Builder Listings: ' || h.unparsed_address, p_message || E'\n\nOpen Builder Listings to update it.', 'home_alerts', aid
    from public.profiles p
    where p.builder_id = h.builder_id and p.is_active
      and (p.role in ('builder_owner', 'manager')
        or (p.role = 'sales' and exists (select 1 from public.community_assignments a where a.profile_id = p.id and a.community_id = h.community_id)));
  end if;
  if p_audience in ('team', 'both') and p_severity = 'urgent' then
    perform private.queue_team_email('URGENT: ' || h.unparsed_address, p_message, 'home_alerts', aid);
  end if;
  return aid;
end $$;

create or replace function private.resolve_alerts(p_home uuid, p_kind text, p_resolution text)
returns void language sql security definer set search_path = '' as $$
  update public.home_alerts set resolved_at = now(), resolved_by = auth.uid(), resolution = p_resolution
  where home_id = p_home and kind = p_kind and resolved_at is null
$$;
revoke execute on function private.raise_alert(uuid, text, text, text, text, timestamptz), private.resolve_alerts(uuid, text, text)
  from public, anon, authenticated;

-- ===========================================================================
-- Build-stage triggers
-- ===========================================================================
create or replace function public.homes_stage_triggers()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requester uuid;
begin
  -- Completion date moved out, or the home is done: the past-due nudge goes away.
  if new.build_stage = 'move_in_ready' or (new.estimated_completion is distinct from old.estimated_completion
     and new.estimated_completion >= (now() at time zone 'America/Chicago')::date) then
    perform private.resolve_alerts(new.id, 'completion_past_due', 'Updated');
  end if;

  -- Move-in ready: ask for real photos to replace renderings and plan photos.
  if new.build_stage = 'move_in_ready' and old.build_stage is distinct from 'move_in_ready' and new.deleted_at is null
     and not exists (select 1 from public.media_requests r where r.home_id = new.id and r.status not in ('completed', 'cancelled')) then
    requester := coalesce(auth.uid(), new.updated_by,
      (select id from public.profiles where builder_id = new.builder_id and role = 'builder_owner' and is_active order by created_at limit 1));
    if requester is not null then
      insert into public.media_requests (builder_id, community_id, home_id, needs, notes, requested_by)
      values (new.builder_id, new.community_id, new.id, array['photos'],
        'Automatic: the home is move-in ready. Replace renderings and plan photos with real photos. The representative disclaimer comes off when they arrive.',
        requester);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.homes_stage_triggers() from public, anon, authenticated;
create trigger homes_stage_triggers after update of build_stage, estimated_completion on public.homes
  for each row execute function public.homes_stage_triggers();

-- Real photos delivered for a finished home: take the "representative" disclaimer off.
create or replace function public.media_requests_real_photos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'delivered' and old.status <> 'delivered' and new.home_id is not null then
    perform private.system_update_on();
    update public.homes set show_representative_disclaimer = false
    where id = new.home_id and show_representative_disclaimer and build_stage = 'move_in_ready';
    perform private.system_update_off();
  end if;
  return new;
end $$;
revoke execute on function public.media_requests_real_photos() from public, anon, authenticated;
create trigger media_requests_real_photos after update of status on public.media_requests
  for each row execute function public.media_requests_real_photos();

-- ===========================================================================
-- Sold (and other status changes): treat as urgent, with the MLS deadline.
-- ===========================================================================
create or replace function public.homes_status_urgency()
returns trigger language plpgsql security definer set search_path = '' as $$
declare hours int; deadline timestamptz; label text;
begin
  if new.market_status is distinct from old.market_status and old.workflow_status = 'live_on_mls' then
    hours := coalesce((select (rules ->> 'status_change_hours')::int from public.mls_boards where code = new.mls_board), 48);
    deadline := now() + make_interval(hours => hours);
    label := case new.market_status when 'sold' then 'SOLD' when 'under_contract' then 'Under contract' when 'paused' then 'Paused'
      when 'withdrawn' then 'Off the market' else 'Back on the market' end;
    -- Aim to finish in a third of the MLS's window.
    update public.tasks set due_at = now() + make_interval(hours => greatest(2, hours / 3)), priority = 'high',
      details = coalesce(details, '') || E'\nMLS deadline: ' || to_char(deadline at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central (' || hours || ' hours).'
    where source_table = 'homes_status' and source_id = new.id and status = 'todo' and created_at > now() - interval '1 minute';
    perform private.queue_team_email(label || ': ' || new.unparsed_address || ' (update the MLS)',
      new.unparsed_address || ' was marked ' || lower(label) || ' in Builder Listings. Update ' || coalesce(new.mls_board, 'the MLS')
        || ' by ' || to_char(deadline at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central.',
      'homes', new.id);
    -- Any sold signals and availability nudges are answered.
    if new.market_status <> 'active' then
      perform private.resolve_alerts(new.id, 'sold_signal_website', 'Status updated');
      perform private.resolve_alerts(new.id, 'sold_signal_mls', 'Status updated');
      perform private.resolve_alerts(new.id, 'availability_check', 'Status updated');
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.homes_status_urgency() from public, anon, authenticated;
-- Named to run after homes_tasks (triggers run in name order), which creates the task.
create trigger homes_tasks_urgency after update of market_status on public.homes
  for each row execute function public.homes_status_urgency();

-- One-click weekly answer from the builder: still available / under contract / sold.
create or replace function public.confirm_availability(p_home uuid, p_answer text, p_date date default null, p_price numeric default null)
returns text language plpgsql security definer set search_path = '' as $$
declare h record; r public.user_role := private.my_role();
begin
  select id, builder_id, community_id, workflow_status into h from public.homes where id = p_home;
  if h.id is null or not (private.is_staff() or (private.can_see_home(h.builder_id, h.community_id)
     and r in ('builder_owner', 'manager', 'sales'))) then
    raise exception 'You can''t update this home' using errcode = '42501';
  end if;
  if h.workflow_status <> 'live_on_mls' then raise exception 'This home isn''t live on the MLS' using errcode = '23514'; end if;
  if p_answer = 'available' then
    perform private.system_update_on();
    update public.homes set availability_confirmed_at = now() where id = p_home;
    perform private.system_update_off();
    perform private.resolve_alerts(p_home, 'availability_check', 'Still available');
    return 'available';
  elsif p_answer = 'under_contract' then
    update public.homes set market_status = 'under_contract', purchase_contract_date = coalesce(p_date, current_date) where id = p_home;
    return 'under_contract';
  elsif p_answer = 'sold' then
    if p_price is null then raise exception 'Enter the close price' using errcode = '23514'; end if;
    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price where id = p_home;
    return 'sold';
  end if;
  raise exception 'Unknown answer';
end $$;
revoke execute on function public.confirm_availability(uuid, text, date, numeric) from public, anon;
grant execute on function public.confirm_availability(uuid, text, date, numeric) to authenticated;

-- ===========================================================================
-- Hourly compliance check
-- ===========================================================================
create or replace function private.run_listing_checks()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  today date := (now() at time zone 'America/Chicago')::date;
  raised int := 0;
  hours int;
  issues jsonb;
  msg text;
begin
  -- 1. Estimated completion has passed but the home isn't move-in ready.
  for r in select * from public.homes h where h.deleted_at is null and h.build_stage <> 'move_in_ready'
             and h.estimated_completion < today and h.workflow_status <> 'draft' loop
    perform private.raise_alert(r.id, 'completion_past_due', case when r.workflow_status = 'live_on_mls' then 'urgent' else 'warning' end, 'builder',
      'The estimated completion date (' || to_char(r.estimated_completion, 'Mon DD') || ') has passed. Update the date or mark the home move-in ready'
        || case when r.workflow_status = 'live_on_mls' then ', since the MLS is showing an old date.' else '.' end);
    raised := raised + 1;
  end loop;

  -- 2. Weekly "is it still available?" for every active live listing.
  for r in select * from public.homes h where h.deleted_at is null and h.workflow_status = 'live_on_mls'
             and coalesce(h.market_status, 'active') = 'active'
             and coalesce(h.availability_confirmed_at, h.live_at, h.updated_at) < now() - interval '7 days' loop
    perform private.raise_alert(r.id, 'availability_check',
      case when coalesce(r.availability_confirmed_at, r.live_at, r.updated_at) < now() - interval '10 days' then 'urgent' else 'warning' end, 'both',
      'Is ' || r.unparsed_address || ' still available? Confirm it, or mark it under contract or sold, so the MLS is never out of date.');
    raised := raised + 1;
  end loop;

  -- 3. The builder's website says it's sold or under contract, but we show it active.
  for r in select h.*, w.status_text from public.homes h join public.website_listings w on w.home_id = h.id
             where h.deleted_at is null and h.workflow_status = 'live_on_mls' and coalesce(h.market_status, 'active') = 'active'
               and w.status_text ~* '(sold|under contract|pending|contract)' loop
    perform private.raise_alert(r.id, 'sold_signal_website', 'urgent', 'both',
      'The builder''s website shows "' || r.status_text || '" but the listing is still active. If it''s sold or under contract, mark it now so the MLS is updated in time.');
    raised := raised + 1;
  end loop;

  -- 4. The MLS feed disagrees with us about status.
  for r in select h.*, m.standard_status from public.homes h join public.mls_listings m on m.home_id = h.id
             where h.deleted_at is null and h.workflow_status = 'live_on_mls'
               and ((coalesce(h.market_status, 'active') = 'active' and m.standard_status ~* '(pending|closed|sold|withdrawn|expired|contract)')
                 or (h.market_status in ('sold', 'under_contract', 'withdrawn', 'paused') and m.standard_status ~* '^active$'
                     and h.market_status_at < now() - make_interval(hours => coalesce((select (rules ->> 'status_change_hours')::int from public.mls_boards where code = h.mls_board), 48)))) loop
    perform private.raise_alert(r.id, 'sold_signal_mls', 'urgent', 'team',
      'The MLS shows "' || r.standard_status || '" but Builder Listings has ' || coalesce(r.market_status, 'active') || '. Check and fix whichever is wrong.');
    raised := raised + 1;
  end loop;

  -- 5. Status changes not yet made on the MLS, against the MLS's deadline.
  for r in select t.*, h.mls_board, h.unparsed_address from public.tasks t join public.homes h on h.id = t.home_id
             where t.kind = 'listing_status' and t.status in ('todo', 'in_progress') loop
    hours := coalesce((select (rules ->> 'status_change_hours')::int from public.mls_boards where code = r.mls_board), 48);
    if r.created_at < now() - make_interval(hours => hours / 2) then
      perform private.raise_alert(r.home_id, 'status_overdue',
        case when r.created_at < now() - make_interval(hours => hours) then 'urgent' else 'warning' end, 'team',
        case when r.created_at < now() - make_interval(hours => hours) then 'PAST the MLS deadline: ' else 'Half the MLS window is gone: ' end
          || r.title || '. Deadline was ' || to_char((r.created_at + make_interval(hours => hours)) at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || '.');
      raised := raised + 1;
    end if;
  end loop;

  -- 6. Open houses about to start (or started) that aren't on the MLS yet.
  for r in select t.*, o.starts_at from public.tasks t join public.open_houses o on o.id = t.source_id
             where t.kind = 'open_house_mls' and t.source_table = 'open_houses' and t.status in ('todo', 'in_progress')
               and o.cancelled_at is null and o.starts_at < now() + interval '24 hours' loop
    perform private.raise_alert(r.home_id, 'open_house_not_entered', 'urgent', 'team',
      'An open house starts ' || to_char(r.starts_at at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' and isn''t on the MLS yet.');
    raised := raised + 1;
  end loop;

  -- 7. Live descriptions that break the MLS's contact-info or compensation rules.
  for r in select * from public.homes h where h.deleted_at is null and h.workflow_status in ('live_on_mls', 'approved_for_mls') loop
    issues := public.mls_readiness(r.id);
    select string_agg(i ->> 'message', ' ') into msg from jsonb_array_elements(issues) i
    where i ->> 'code' in ('remarks_phone', 'remarks_email', 'remarks_web', 'remarks_comp', 'remarks_long');
    if msg is not null then
      perform private.raise_alert(r.id, 'remarks_violation', 'urgent', 'both', 'Fix the description before the MLS fines it: ' || msg);
      raised := raised + 1;
    end if;
  end loop;

  -- 8. Under contract a long time (NTREIS checks pending listings at 90 days).
  for r in select * from public.homes h where h.deleted_at is null and h.market_status = 'under_contract'
             and coalesce(h.purchase_contract_date, h.market_status_at::date) < today - 85 loop
    perform private.raise_alert(r.id, 'long_pending', 'warning', 'both',
      'Under contract since ' || to_char(coalesce(r.purchase_contract_date, r.market_status_at::date), 'Mon DD') || '. Has it closed? The MLS flags long pending listings at 90 days.');
    raised := raised + 1;
  end loop;

  -- Resolve alerts whose problem is gone.
  update public.home_alerts a set resolved_at = now(), resolution = 'Fixed'
  where a.resolved_at is null and (
       (a.kind = 'completion_past_due' and exists (select 1 from public.homes h where h.id = a.home_id
          and (h.build_stage = 'move_in_ready' or h.estimated_completion >= today or h.deleted_at is not null)))
    or (a.kind in ('availability_check', 'sold_signal_website') and exists (select 1 from public.homes h where h.id = a.home_id
          and (coalesce(h.market_status, 'active') <> 'active' or h.workflow_status <> 'live_on_mls')))
    or (a.kind = 'availability_check' and exists (select 1 from public.homes h where h.id = a.home_id
          and h.availability_confirmed_at >= now() - interval '7 days'))
    or (a.kind = 'status_overdue' and not exists (select 1 from public.tasks t where t.home_id = a.home_id
          and t.kind = 'listing_status' and t.status in ('todo', 'in_progress')))
    or (a.kind = 'open_house_not_entered' and not exists (select 1 from public.tasks t where t.home_id = a.home_id
          and t.kind = 'open_house_mls' and t.source_table = 'open_houses' and t.status in ('todo', 'in_progress')))
    or (a.kind = 'remarks_violation' and not exists (select 1 from jsonb_array_elements(public.mls_readiness(a.home_id)) i
          where i ->> 'code' in ('remarks_phone', 'remarks_email', 'remarks_web', 'remarks_comp', 'remarks_long')))
    or (a.kind = 'long_pending' and exists (select 1 from public.homes h where h.id = a.home_id and h.market_status is distinct from 'under_contract'))
  );
  return raised;
end $$;
revoke execute on function private.run_listing_checks() from public, anon, authenticated;

-- The hourly job runs with no signed-in user; let the readiness check run for it.
do $do$
declare src text;
begin
  src := pg_get_functiondef('public.mls_readiness(uuid)'::regprocedure);
  src := replace(src, $x$if h.id is null or not (private.is_staff() or private.can_see_home(h.builder_id, h.community_id)) then$x$,
    $x$if h.id is null or (auth.uid() is not null and not (private.is_staff() or private.can_see_home(h.builder_id, h.community_id))) then$x$);
  execute src;
end $do$;

select cron.schedule('listing-checks', '23 * * * *', $$select private.run_listing_checks()$$);

-- Our admins can run the check on demand (Admin or the Compliance page).
create or replace function public.run_listing_checks_now()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then raise exception 'Our team only' using errcode = '42501'; end if;
  return private.run_listing_checks();
end $$;
revoke execute on function public.run_listing_checks_now() from public, anon;
grant execute on function public.run_listing_checks_now() to authenticated;

-- Demo: realistic history for reports (when each listing was approved and went live).
do $do$
begin
  perform private.system_update_on();
  update public.homes h set
    live_at = now() - make_interval(days => 8 + (abs(hashtext(h.id::text)) % 75)),
    approved_at = now() - make_interval(days => 8 + (abs(hashtext(h.id::text)) % 75)) - make_interval(hours => 3 + (abs(hashtext(h.id::text || 'a')) % 60)),
    availability_confirmed_at = now() - make_interval(days => abs(hashtext(h.id::text || 'c')) % 12),
    market_status_at = now() - make_interval(days => 8 + (abs(hashtext(h.id::text)) % 75))
  where h.workflow_status = 'live_on_mls' and h.live_at is null;
  update public.homes h set approved_at = now() - make_interval(hours => 5 + (abs(hashtext(h.id::text)) % 40))
  where h.workflow_status = 'approved_for_mls' and h.approved_at is null;
  perform private.system_update_off();
end $do$;
