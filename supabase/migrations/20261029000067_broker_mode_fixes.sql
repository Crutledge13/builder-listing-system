-- Broker mode fixes from the security review (29 Oct 2026).
--
-- 1. Takeover: an owner could link another builder's broker by email before
--    that broker had set a password, then make the broker's invite link and
--    choose the password themselves. Now:
--    - an owner adds or links brokers only while their builder is in broker
--      mode (our admins any time);
--    - an existing broker can only be linked once they've set their password
--      (a brand-new one is made with add_broker instead);
--    - an owner may make a broker's invite link only when that broker works
--      for their builder and no other (so only the builder that created the
--      login can send it). Our admins always can.
-- 2. One message for "can't be added" either way, so owners can't use it to
--    learn who has a login.
-- 3. Brokers no longer read app_settings (it holds our price list).
-- 4. Small fixes: a finished new listing can't be reopened by the broker;
--    the "done" notice says "your broker" only when the broker did it; a
--    note never loses its author's name.

-- 1a. Owners manage brokers only in broker mode.
create or replace function private.can_manage_brokers(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(b is not null and (private.my_role() = 'platform_admin'
    or (private.my_role() = 'builder_owner' and private.my_builder_id() = b and private.broker_mode(b))), false)
$$;

-- 1b + 2. Linking an existing broker: only one who has finished setting up.
create or replace function public.link_broker(p_builder uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare p record; n int; pending boolean;
begin
  if not private.can_manage_brokers(p_builder) then
    raise exception 'Only the builder''s owner (or our admins) can add a broker, while the builder lists through its own broker' using errcode = '42501';
  end if;
  select pr.id, pr.role, pr.is_active, coalesce((u.raw_user_meta_data ->> 'needs_password')::boolean, false) as needs_password
    into p
  from public.profiles pr left join auth.users u on u.id = pr.id
  where lower(pr.email) = lower(trim(p_email));
  if p.id is null then return 'none'; end if;
  if p.role <> 'broker' or not p.is_active or p.needs_password then
    raise exception 'That email can''t be added as a broker. Ask our team if you think it should be' using errcode = '42501';
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

-- 1c. Invite links: admins, or the owner of the only builder the broker works for.
create or replace function public.can_invite_broker(p_broker uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
    or (exists (select 1 from public.profiles p where p.id = p_broker and p.role = 'broker' and p.is_active)
        and exists (select 1 from public.broker_builders l
                    where l.broker_id = p_broker and l.removed_at is null and private.can_manage_brokers(l.builder_id))
        and not exists (select 1 from public.broker_builders l
                        where l.broker_id = p_broker and l.builder_id is distinct from private.my_builder_id())), false)
$$;
revoke all on function public.can_invite_broker(uuid) from public, anon;
grant execute on function public.can_invite_broker(uuid) to authenticated;

-- 3. App settings: everyone signed in except brokers.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_settings' and cmd = 'SELECT' and qual = 'true' loop
    execute format('alter policy %I on public.app_settings using (coalesce(private.my_role() <> ''broker'', true))', pol.policyname);
  end loop;
end $$;

-- 4a. A broker can't reopen a new listing that's already live.
create or replace function public.broker_set_status(p_task uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.broker_task(p_task);
  if t.id is null then raise exception 'That task wasn''t found' using errcode = '42501'; end if;
  if p_status not in ('todo', 'in_progress', 'done') then raise exception 'Unknown status' using errcode = '22023'; end if;
  if t.kind = 'mls_entry' and (p_status = 'done' or t.status = 'done') then
    raise exception 'A new listing is finished by entering its MLS number' using errcode = '22023';
  end if;
  update public.tasks set status = p_status where id = t.id;
end $$;
revoke all on function public.broker_set_status(uuid, text) from public, anon;
grant execute on function public.broker_set_status(uuid, text) to authenticated;

-- 4b. "Your broker…" only when the broker finished it.
create or replace function public.tasks_broker_done() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; subject text; body text; p record; by_broker boolean;
begin
  if new.status <> 'done' or old.status = 'done' or not private.is_mls_task(new.kind)
     or new.builder_id is null or not private.broker_mode(new.builder_id) then
    return null;
  end if;
  by_broker := coalesce(private.my_role() = 'broker', false);
  select unparsed_address, mls_number, mls_board into h from public.homes where id = new.home_id;
  subject := case new.kind
    when 'mls_entry' then 'Live on the MLS: ' || coalesce(h.unparsed_address, new.title) || coalesce(' (#' || h.mls_number || ')', '')
    when 'mls_update' then (case when by_broker then 'Your broker updated the MLS: ' else 'MLS listing updated: ' end) || coalesce(h.unparsed_address, new.title)
    when 'open_house_mls' then 'Open house updated on the MLS: ' || coalesce(h.unparsed_address, new.title)
    else (case when by_broker then 'Your broker changed the status on the MLS: ' else 'MLS status changed: ' end) || coalesce(h.unparsed_address, new.title) end;
  body := case
    when new.kind = 'mls_entry' then (case when by_broker then 'Your broker entered it on ' else 'It was entered on ' end)
      || coalesce(h.mls_board, 'the MLS') || coalesce(' as #' || h.mls_number, '') || '.'
    else (case when by_broker then 'Your broker finished: ' else 'Finished: ' end) || new.title || '.' end;
  perform private.notify_builder(new.builder_id, array['builder_owner', 'manager', 'marketing'], new.community_id, 'mls',
    subject, body, coalesce('/homes/' || new.home_id, '/communities'));
  for p in select id from public.profiles where builder_id = new.builder_id and is_active and role in ('builder_owner', 'marketing') loop
    perform private.queue_email_to(p.id, subject, body, 'tasks', new.id);
  end loop;
  return null;
end $$;
revoke all on function public.tasks_broker_done() from public, anon, authenticated;

-- 4c. A note always carries a name.
do $$ declare d text; begin
  d := pg_get_functiondef('public.broker_add_note'::regproc);
  d := replace(d, $x$  select full_name into me from public.profiles where id = auth.uid();$x$,
    $x$  select coalesce(nullif(trim(full_name), ''), 'Your broker') into me from public.profiles where id = auth.uid();$x$);
  if position('Your broker'') into me' in d) = 0 then raise exception 'broker_add_note: pattern not found'; end if;
  execute d;
end $$;
