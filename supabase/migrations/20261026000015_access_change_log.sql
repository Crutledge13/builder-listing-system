-- Every change to who can do what goes in the activity log: people added,
-- role or company changes, access turned off or on, and salespeople assigned
-- to or removed from communities. builder_id is the person's company, so
-- builder owners and managers see their own company's history; our staff see all.
create or replace function public.profiles_log_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare who jsonb := jsonb_build_object('person_id', new.id, 'name', new.full_name, 'email', new.email);
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_added', who || jsonb_build_object('role', new.role));
    return new;
  end if;
  if new.role is distinct from old.role then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_role_changed', who || jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.builder_id is distinct from old.builder_id then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (coalesce(new.builder_id, old.builder_id), auth.uid(), 'person_company_changed',
            who || jsonb_build_object('from', old.builder_id, 'to', new.builder_id));
  end if;
  if new.is_active is distinct from old.is_active then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), case when new.is_active then 'person_turned_on' else 'person_turned_off' end, who);
  end if;
  return new;
end $$;
revoke execute on function public.profiles_log_access() from public, anon, authenticated;
create trigger profiles_log_access after insert or update on public.profiles
  for each row execute function public.profiles_log_access();

create or replace function public.community_assignments_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; p record; c record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select id, full_name, email, builder_id into p from public.profiles where id = r.profile_id;
  select id, name, builder_id into c from public.communities where id = r.community_id;
  insert into public.activity_log (builder_id, actor_id, action, changes)
  values (c.builder_id, auth.uid(), case when tg_op = 'DELETE' then 'sales_community_removed' else 'sales_community_added' end,
          jsonb_build_object('person_id', p.id, 'name', p.full_name, 'email', p.email, 'community_id', c.id, 'community', c.name));
  return null;
end $$;
revoke execute on function public.community_assignments_log() from public, anon, authenticated;
create trigger community_assignments_log after insert or delete on public.community_assignments
  for each row execute function public.community_assignments_log();

-- Who-has-access history is for builder owners and managers (their company)
-- and our staff (everything, including staff and photographer accounts).
alter policy "see activity for visible homes" on public.activity_log
  using (
    private.can_see_builder(builder_id)
    and (home_id is null or exists (select 1 from public.homes h where h.id = activity_log.home_id))
    and (
      not (action like 'person\_%' or action like 'sales\_community\_%')
      or private.is_staff()
      or private.my_role() in ('builder_owner', 'manager')
    )
  );
