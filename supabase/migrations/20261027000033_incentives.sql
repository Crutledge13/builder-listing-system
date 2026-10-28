-- Incentives at three levels: the whole builder, one community, or one home.
-- Every incentive has an end date. A week before it ends, the builder's
-- marketing team gets a to-do and a notice to extend it or end it. Anything
-- that changes what a live listing should say (added, extended, ended, or
-- expired on its end date) goes on our team's MLS update task for each live
-- home it covers.

create table public.incentives (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  community_id uuid references public.communities(id),
  home_id uuid references public.homes(id) on delete cascade,
  scope text not null default 'builder' check (scope in ('builder', 'community', 'home')),
  title text not null check (length(trim(title)) between 1 and 120),
  details text check (length(details) <= 2000),
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  reminded_at timestamptz,       -- when the "ending soon" to-do went out
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id)
);
create index incentives_open on public.incentives (builder_id, status, ends_on);
create index incentives_home on public.incentives (home_id) where home_id is not null;
create index incentives_community on public.incentives (community_id) where community_id is not null;

-- Today in Texas (Central time).
create or replace function private.today_central() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Chicago')::date $$;

alter table public.incentives enable row level security;
-- Who sees an incentive follows who sees its homes (sales: their communities plus builder-wide ones).
create policy "see incentives" on public.incentives for select to authenticated
  using (private.is_staff() or private.can_see_home(builder_id, community_id));
-- Owners, managers and marketing manage their builder's incentives; our admins any.
create policy "add incentives" on public.incentives for insert to authenticated
  with check (private.on_builder_board(builder_id));
create policy "change incentives" on public.incentives for update to authenticated
  using (private.on_builder_board(builder_id)) with check (private.on_builder_board(builder_id));

-- How an incentive reads on a work sheet line.
create or replace function private.incentive_text(i public.incentives) returns jsonb
language sql stable set search_path = '' as $$
  select case when i.status = 'active' then to_jsonb(
    i.title || ' (ends ' || to_char(i.ends_on, 'FMMonth FMDD, YYYY') || ')' || coalesce(': ' || nullif(trim(i.details), ''), ''))
  end
$$;

create or replace function public.incentives_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; c_builder uuid; txt text;
begin
  if tg_op = 'UPDATE' then
    new.builder_id := old.builder_id;
    new.community_id := old.community_id;
    new.home_id := old.home_id;
    new.scope := old.scope;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    -- Fill the builder and community in from the home or community, and check they match.
    if new.home_id is not null then
      select builder_id, community_id into h from public.homes where id = new.home_id and deleted_at is null;
      if h is null then raise exception 'That home wasn''t found'; end if;
      new.builder_id := h.builder_id;
      new.community_id := h.community_id;
      new.scope := 'home';
    elsif new.community_id is not null then
      select builder_id into c_builder from public.communities where id = new.community_id;
      if c_builder is null or c_builder <> new.builder_id then raise exception 'That community belongs to another builder'; end if;
      new.scope := 'community';
    else
      new.scope := 'builder';
    end if;
    new.status := 'active';
    new.reminded_at := null;
    new.ended_at := null;
    new.ended_by := null;
  end if;

  new.title := trim(new.title);
  new.details := nullif(trim(coalesce(new.details, '')), '');
  -- NTREIS: no agent compensation in any field, so it can't be an incentive here either.
  txt := new.title || ' ' || coalesce(new.details, '');
  if txt ~* '(commission|compensation|co-?broke|bonus to (the )?(buyer|selling|realtor|agent)|(buyer''?s?|realtor|agent) bonus|\m\d+(\.\d+)?\s*% (to|for) (buyer|selling|the agent))' then
    raise exception 'Agent compensation can''t go in an incentive (the MLS doesn''t allow it in any field). Incentives are for buyers, like closing costs or a rate buydown.';
  end if;

  -- Extending: a new end date (also reopens one that expired) starts the reminder over.
  if tg_op = 'UPDATE' and new.ends_on is distinct from old.ends_on then
    new.reminded_at := null;
    if old.status = 'expired' and new.status = 'expired' then new.status := 'active'; end if;
  end if;
  if tg_op = 'INSERT' or new.ends_on is distinct from old.ends_on or (new.status = 'active' and old.status <> 'active') then
    if new.status = 'active' and new.ends_on < private.today_central() then
      raise exception 'Pick an end date that''s today or later';
    end if;
  end if;
  if new.ends_on > private.today_central() + interval '2 years' then
    raise exception 'Pick an end date within two years';
  end if;

  if tg_op = 'UPDATE' then
    if new.status <> 'active' and old.status = 'active' then
      new.ended_at := now();
      new.ended_by := auth.uid();
    elsif new.status = 'active' and old.status <> 'active' then
      new.ended_at := null;
      new.ended_by := null;
      new.reminded_at := null;
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.incentives_prepare() from public, anon, authenticated;
create trigger incentives_prepare before insert or update on public.incentives
  for each row execute function public.incentives_prepare();

-- After a change: close the reminder when it's handled, log it on the home,
-- and queue MLS updates for live homes the incentive covers.
create or replace function public.incentives_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare was jsonb; now_text jsonb; hid uuid; act text;
begin
  was := case when tg_op = 'UPDATE' then private.incentive_text(old) end;
  now_text := private.incentive_text(new);

  if tg_op = 'UPDATE' and (new.status <> 'active' or new.ends_on is distinct from old.ends_on) then
    perform private.close_builder_tasks('incentives', new.id, 'done');
  end if;

  if was is distinct from now_text then
    for hid in
      select h.id from public.homes h
      where h.deleted_at is null and h.workflow_status = 'live_on_mls' and h.builder_id = new.builder_id
        and (new.scope = 'builder' or (new.scope = 'community' and h.community_id = new.community_id) or (new.scope = 'home' and h.id = new.home_id))
    loop
      perform private.note_mls_change(hid, 'incentive:' || new.id, 'Incentive: ' || new.title, coalesce(was, 'null'::jsonb), coalesce(now_text, 'null'::jsonb));
    end loop;
  end if;

  if new.home_id is not null then
    act := case
      when tg_op = 'INSERT' then 'incentive_added'
      when new.status = 'expired' and old.status <> 'expired' then 'incentive_expired'
      when new.status = 'ended' and old.status <> 'ended' then 'incentive_ended'
      when new.ends_on is distinct from old.ends_on then 'incentive_extended'
      when was is distinct from now_text then 'incentive_changed'
    end;
    if act is not null then
      insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
      values (new.builder_id, new.home_id, auth.uid(), act,
        jsonb_build_object('incentive', jsonb_build_object('from', was, 'to', now_text)));
    end if;
  end if;
  return null;
end $$;
revoke all on function public.incentives_after() from public, anon, authenticated;
create trigger incentives_after after insert or update on public.incentives
  for each row execute function public.incentives_after();

-- Builder to-dos can point at an incentive.
create or replace function private.incentive_href(i public.incentives) returns text
language sql immutable set search_path = '' as $$ select '/incentives#i-' || i.id $$;

-- Daily: a week out, remind marketing to extend or end it; past the end date, it expires.
create or replace function private.run_incentive_checks() returns void
language plpgsql security definer set search_path = '' as $$
declare i public.incentives; where_text text; p record; today date := private.today_central();
begin
  for i in
    select * from public.incentives where status = 'active' and reminded_at is null and ends_on <= today + 7
  loop
    where_text := case i.scope
      when 'home' then (select unparsed_address from public.homes where id = i.home_id)
      when 'community' then (select name from public.communities where id = i.community_id)
      else 'all communities' end;
    perform private.add_builder_task(i.builder_id, 'incentive',
      'Incentive ending ' || to_char(i.ends_on, 'Mon FMDD') || ': ' || i.title,
      'For ' || where_text || '. Extend it with a new end date, or end it. Either way we update the MLS for you.',
      i.home_id, i.community_id, 'incentives', i.id, (i.ends_on::timestamp + interval '17 hours') at time zone 'America/Chicago',
      case when i.ends_on <= today + 2 then 'high' else 'normal' end);
    perform private.notify_builder(i.builder_id, array['marketing'], i.community_id, 'incentive',
      'Incentive ending ' || to_char(i.ends_on, 'Mon FMDD') || ': ' || i.title,
      'For ' || where_text || '. Extend it or end it so the MLS stays right.', private.incentive_href(i));
    for p in select id from public.profiles where builder_id = i.builder_id and is_active and role = 'marketing' loop
      perform private.queue_email_to(p.id, 'Incentive ending ' || to_char(i.ends_on, 'Mon FMDD') || ': ' || i.title,
        'The incentive "' || i.title || '" for ' || where_text || ' ends on ' || to_char(i.ends_on, 'FMMonth FMDD, YYYY')
          || E'.\n\nOpen Builder Listings to extend it or end it. We''ll update the MLS either way.',
        'incentives', i.id);
    end loop;
    update public.incentives set reminded_at = now() where id = i.id;
  end loop;

  -- Past the end date and nobody extended it: it ends on its own (and the MLS update is queued by the trigger).
  for i in select * from public.incentives where status = 'active' and ends_on < today loop
    update public.incentives set status = 'expired' where id = i.id;
    perform private.notify_builder(i.builder_id, array['builder_owner', 'manager', 'marketing'], i.community_id, 'incentive',
      'Incentive ended: ' || i.title, 'It passed its end date, so it''s off your listings now. Extend it to bring it back.', private.incentive_href(i));
  end loop;
end $$;
revoke all on function private.run_incentive_checks() from public, anon, authenticated;

select cron.schedule('incentive-checks', '7 12 * * *', $$select private.run_incentive_checks()$$);

-- Everything that applies to one home right now (its own, its community's, the builder's).
create or replace function public.home_incentives(p_home uuid) returns setof public.incentives
language sql stable security invoker set search_path = '' as $$
  select i.* from public.incentives i join public.homes h on h.id = p_home
  where i.status = 'active' and i.builder_id = h.builder_id
    and (i.scope = 'builder' or (i.scope = 'community' and i.community_id = h.community_id) or (i.scope = 'home' and i.home_id = h.id))
  order by case i.scope when 'home' then 0 when 'community' then 1 else 2 end, i.ends_on
$$;
revoke all on function public.home_incentives(uuid) from public, anon;
grant execute on function public.home_incentives(uuid) to authenticated;

-- Realtor share pages show the home's current incentives (buyer incentives only;
-- agent compensation is refused above).
do $$ declare d text; begin
  d := pg_get_functiondef('public.share_page'::regproc);
  if position('''incentives''' in d) > 0 then return; end if;
  d := replace(d, $x$    'tours', coalesce(($x$, $x$    'incentives', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'details', i.details, 'ends_on', i.ends_on, 'scope', i.scope)
        order by case i.scope when 'home' then 0 when 'community' then 1 else 2 end, i.ends_on)
      from public.incentives i
      where i.status = 'active' and i.ends_on >= private.today_central() and i.builder_id = h.builder_id
        and (i.scope = 'builder' or (i.scope = 'community' and i.community_id = h.community_id) or (i.scope = 'home' and i.home_id = h.id))
    ), '[]'),
    'tours', coalesce(($x$);
  if position('''incentives''' in d) = 0 then raise exception 'share_page: pattern not found'; end if;
  execute d;
end $$;
