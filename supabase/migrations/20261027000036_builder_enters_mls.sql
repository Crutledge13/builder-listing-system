-- Builders who use the software on their own and enter listings in the MLS
-- themselves. One switch per builder (set by our admins): who enters listings
-- in the MLS, our team or the builder's team. When it's the builder's team,
-- the MLS work our team would get comes to them instead: the work sheets
-- (new listings, updates, status changes, open houses) with the same copy
-- buttons, the MLS sheet, "issue noticed" alerts that were team-only, and
-- notices and emails when something is ready or needs changing.

alter table public.builder_settings
  add column mls_entry text not null default 'our_team' check (mls_entry in ('our_team', 'builder'));

-- Only our admins change who enters the MLS (it's part of what the builder pays for).
create or replace function public.builder_settings_mls_entry_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mls_entry is distinct from (case when tg_op = 'UPDATE' then old.mls_entry else 'our_team' end)
     and auth.uid() is not null and private.my_role() <> 'platform_admin' then
    raise exception 'Only our admins change who enters listings in the MLS' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.builder_settings_mls_entry_guard() from public, anon, authenticated;
create trigger builder_settings_mls_entry_guard before insert or update on public.builder_settings
  for each row execute function public.builder_settings_mls_entry_guard();

create or replace function private.builder_enters_mls(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select mls_entry = 'builder' from public.builder_settings where builder_id = b), false)
$$;
revoke all on function private.builder_enters_mls(uuid) from public, anon;
grant execute on function private.builder_enters_mls(uuid) to authenticated;

-- Who works a builder's MLS listings: our staff always; the builder's owners,
-- managers and marketing when the builder enters its own.
create or replace function private.can_work_mls(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b is not null and b = private.my_builder_id()
          and private.my_role() in ('builder_owner', 'manager', 'marketing')
          and private.builder_enters_mls(b))
$$;
revoke all on function private.can_work_mls(uuid) from public, anon;
grant execute on function private.can_work_mls(uuid) to authenticated;

-- The MLS kinds of work that move to the builder.
create or replace function private.is_mls_task(k text) returns boolean
language sql immutable set search_path = '' as $$ select k in ('mls_entry', 'mls_update', 'listing_status', 'open_house_mls') $$;
grant execute on function private.is_mls_task(text) to authenticated;

-- Tasks: the builder's team sees and works its own MLS tasks.
create policy "builder sees its MLS work" on public.tasks for select to authenticated
  using (private.is_mls_task(kind) and builder_id is not null and not private.is_staff() and private.can_work_mls(builder_id));
create policy "builder works its MLS work" on public.tasks for update to authenticated
  using (private.is_mls_task(kind) and builder_id is not null and not private.is_staff() and private.can_work_mls(builder_id))
  with check (private.is_mls_task(kind) and builder_id is not null and private.can_work_mls(builder_id));

-- What the builder's team may change on a task: status, ticks and who's on it.
create or replace function public.tasks_builder_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_staff() then return new; end if;
  if (to_jsonb(new) - array['status', 'checked', 'assignee_id', 'updated_at', 'completed_at', 'completed_by'])
     is distinct from (to_jsonb(old) - array['status', 'checked', 'assignee_id', 'updated_at', 'completed_at', 'completed_by']) then
    raise exception 'You can change the status, the ticks and who''s on it' using errcode = '42501';
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id and p.is_active and p.builder_id = new.builder_id
      and p.role in ('builder_owner', 'manager', 'marketing')) then
    raise exception 'Assign it to an owner, manager or marketing person at your company';
  end if;
  return new;
end $$;
revoke all on function public.tasks_builder_guard() from public, anon, authenticated;
create trigger tasks_builder_guard before update on public.tasks
  for each row execute function public.tasks_builder_guard();

-- Task notes on those tasks.
create policy "builder sees notes on its MLS work" on public.task_notes for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "builder adds notes on its MLS work" on public.task_notes for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id));

-- MLS details (schools, HOA, showing setup, listing paperwork): the builder's team fills them in.
create policy "builder adds its MLS details" on public.mls_details for insert to authenticated
  with check (not private.is_staff() and private.can_work_mls(builder_id));
create policy "builder edits its MLS details" on public.mls_details for update to authenticated
  using (not private.is_staff() and private.can_work_mls(builder_id)) with check (private.can_work_mls(builder_id));

-- When MLS work lands for a builder who enters its own: tell them right away.
create or replace function public.tasks_builder_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p record; subject text;
begin
  if not private.is_mls_task(new.kind) or new.builder_id is null or not private.builder_enters_mls(new.builder_id) then
    return null;
  end if;
  subject := case new.kind
    when 'mls_entry' then 'Ready to add to your MLS: '
    when 'mls_update' then 'Update your MLS listing: '
    when 'open_house_mls' then 'Open house to put on your MLS: '
    else 'Listing status to update on your MLS: ' end
    || coalesce((select unparsed_address from public.homes where id = new.home_id), new.title);
  perform private.notify_builder(new.builder_id, array['builder_owner', 'manager', 'marketing'], null, 'mls', subject,
    coalesce(new.details, 'Open the work sheet for what to enter.'), '/tasks/' || new.id);
  -- Status changes email separately with the MLS deadline (homes_status_urgency).
  if new.kind <> 'listing_status' then
    for p in select id from public.profiles where builder_id = new.builder_id and is_active and role in ('builder_owner', 'manager', 'marketing') loop
      perform private.queue_email_to(p.id, subject,
        coalesce(new.details, '') || E'\n\nOpen the work sheet in Builder Listings: it has every field to copy into the MLS.', 'tasks', new.id);
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.tasks_builder_notice() from public, anon, authenticated;
create trigger tasks_builder_notice after insert on public.tasks
  for each row execute function public.tasks_builder_notice();

-- Homes: the builder's team marks a listing live with its MLS number.
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_home_edit_rules'::regproc);
  d := replace(d, $x$  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);$x$,
    $x$  if r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id) then
    allowed := allowed || array['mls_number', 'workflow_status'];
  end if;
  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);$x$);
  d := replace(d, $x$      or (r = 'listing_coordinator' and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')$x$,
    $x$      or (r = 'listing_coordinator' and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')
      or (r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id)
          and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')$x$);
  if position('builder_enters_mls' in d) = 0 then raise exception 'enforce_home_edit_rules: pattern not found'; end if;
  execute d;
end $$;

-- Status changes on a live listing: the MLS-deadline email goes to whoever enters the MLS.
do $$ declare d text; begin
  d := pg_get_functiondef('public.homes_status_urgency'::regproc);
  d := replace(d, $x$    perform private.queue_team_email(label || ': ' || new.unparsed_address || ' (update the MLS)',
      new.unparsed_address || ' was marked ' || lower(label) || ' in Builder Listings. Update ' || coalesce(new.mls_board, 'the MLS')
        || ' by ' || to_char(deadline at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central.',
      'homes', new.id);$x$, $x$    if private.builder_enters_mls(new.builder_id) then
      perform private.queue_email_to(p.id, label || ': ' || new.unparsed_address || ' (update your MLS listing)',
        new.unparsed_address || ' was marked ' || lower(label) || ' in Builder Listings. Update ' || coalesce(new.mls_board, 'the MLS')
          || ' by ' || to_char(deadline at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central. The work sheet in Builder Listings has what to change.',
        'homes', new.id)
      from public.profiles p where p.builder_id = new.builder_id and p.is_active and p.role in ('builder_owner', 'manager', 'marketing');
    else
      perform private.queue_team_email(label || ': ' || new.unparsed_address || ' (update the MLS)',
        new.unparsed_address || ' was marked ' || lower(label) || ' in Builder Listings. Update ' || coalesce(new.mls_board, 'the MLS')
          || ' by ' || to_char(deadline at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || ' Central.',
        'homes', new.id);
    end if;$x$);
  if position('update your MLS listing' in d) = 0 then raise exception 'homes_status_urgency: pattern not found'; end if;
  execute d;
end $$;

-- Alerts our team would get ("issue noticed": MLS feed mismatch, deadlines, rule
-- breaks) go to the builder too when they enter their own MLS.
do $$ declare d text; begin
  d := pg_get_functiondef('private.raise_alert'::regproc);
  d := replace(d, $x$  select id, builder_id, community_id, unparsed_address into h from public.homes where id = p_home;$x$,
    $x$  select id, builder_id, community_id, unparsed_address into h from public.homes where id = p_home;
  if p_audience = 'team' and private.builder_enters_mls(h.builder_id) then p_audience := 'both'; end if;$x$);
  d := replace(d, $x$      and (p.role in ('builder_owner', 'manager')$x$,
    $x$      and (p.role in ('builder_owner', 'manager')
        or (p.role = 'marketing' and private.builder_enters_mls(h.builder_id))$x$);
  d := replace(d, $x$  if p_audience in ('team', 'both') and p_severity = 'urgent' then$x$,
    $x$  if p_audience in ('team', 'both') and p_severity = 'urgent' and not private.builder_enters_mls(h.builder_id) then$x$);
  if position('builder_enters_mls(h.builder_id) then p_audience' in d) = 0 then raise exception 'raise_alert: pattern not found'; end if;
  execute d;
end $$;
alter policy "see alerts" on public.home_alerts
  using (private.is_staff() or ((audience <> 'team' or private.builder_enters_mls(builder_id)) and private.can_see_home(builder_id, community_id)));
