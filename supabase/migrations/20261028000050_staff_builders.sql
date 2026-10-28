-- Our staff can be assigned to the builders they work on (owners, 28 Oct 2026).
--
-- A listing coordinator ticked for one or more builders sees only those
-- builders: their homes, communities, media, tasks, MLS work, alerts, people
-- and requests. A coordinator with no builders ticked sees every builder (as
-- before), so nothing changes until someone is assigned. Platform admins
-- always see everything. Items that belong to no builder (general team tasks,
-- help reports, our own staff) stay visible to all staff.
--
-- How: one check, private.staff_for(builder), replaces "is this person staff?"
-- wherever staff get at one builder's data: the shared helpers, the table
-- rules (RLS) and the database functions that hand out a builder's data.
-- RULE FOR NEW CODE: when staff get access to something that belongs to a
-- builder, use private.staff_for(builder_id), not private.is_staff().
--
-- The rules and functions below are edited from their current wording (the
-- other changes made today keep their text); each edit stops with an error if
-- the wording isn't what this change expects.

create table public.staff_builders (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  builder_id uuid not null references public.builders(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  primary key (profile_id, builder_id)
);
create index staff_builders_builder on public.staff_builders (builder_id);

-- Does this staff member work on builder b? (null b = not tied to a builder)
create or replace function private.staff_for(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff() and (
    private.my_role() = 'platform_admin'
    or b is null
    or not exists (select 1 from public.staff_builders s where s.profile_id = auth.uid())
    or exists (select 1 from public.staff_builders s where s.profile_id = auth.uid() and s.builder_id = b)
  ), false)
$$;
revoke all on function private.staff_for(uuid) from public, anon;
grant execute on function private.staff_for(uuid) to authenticated;

alter table public.staff_builders enable row level security;
revoke all on public.staff_builders from anon;
create policy "staff see builder assignments" on public.staff_builders
  for select to authenticated using (profile_id = auth.uid() or private.my_role() = 'platform_admin');
create policy "admins assign staff to builders" on public.staff_builders
  for insert to authenticated with check (private.my_role() = 'platform_admin');
create policy "admins unassign staff from builders" on public.staff_builders
  for delete to authenticated using (private.my_role() = 'platform_admin');

-- Only listing coordinators are assigned (admins see everything anyway), and
-- every assignment is logged on that builder's access history.
create or replace function public.staff_builders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.profiles where id = new.profile_id and role = 'listing_coordinator') then
      raise exception 'Only listing coordinators are assigned to builders. Platform admins see every builder.' using errcode = '23514';
    end if;
    select full_name into who from public.profiles where id = new.profile_id;
    insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
    values (new.builder_id, null, auth.uid(), 'person_staff_builder_added', jsonb_build_object('person', who));
    return new;
  end if;
  select full_name into who from public.profiles where id = old.profile_id;
  insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
  values (old.builder_id, null, auth.uid(), 'person_staff_builder_removed', jsonb_build_object('person', who));
  return old;
end $$;
create trigger staff_builders_guard before insert or delete on public.staff_builders
  for each row execute function public.staff_builders_guard();

-- 1. Shared helpers and functions: "staff" becomes "staff for this builder".
do $$
declare
  f record;
  d text;
  e text;
begin
  for f in select * from (values
    ('private.can_see_builder(uuid)',         'private.staff_for(target)'),
    ('private.can_see_home(uuid,uuid)',        'private.staff_for(b)'),
    ('private.can_see_media(uuid,uuid)',       'private.staff_for(b)'),
    ('private.can_run_setup(uuid)',            'private.staff_for(b)'),
    ('private.can_use_builder_ai(uuid)',       'private.staff_for(p_builder)'),
    ('private.can_work_mls(uuid)',             'private.staff_for(b)'),
    ('public.confirm_availability(uuid,text,date,numeric,jsonb)', 'private.staff_for(h.builder_id)'),
    ('public.extend_listing(uuid,date)',       'private.staff_for(h.builder_id)'),
    ('public.home_share_link(uuid)',           'private.staff_for(h.builder_id)'),
    ('public.mls_readiness(uuid)',             'private.staff_for(h.builder_id)'),
    ('public.ai_usage_summary()',              'private.staff_for(b.id)')
  ) v(sig, rep) loop
    d := pg_get_functiondef(f.sig::regprocedure);
    if position('private.is_staff()' in d) = 0 then
      raise exception 'staff_builders: % no longer checks private.is_staff(); update this change', f.sig;
    end if;
    e := replace(d, 'private.is_staff()', f.rep);
    execute e;
  end loop;
end $$;

-- 2. Table rules (RLS) where staff reach one builder's rows.
do $$
declare
  r record;
  q text;
  c text;
begin
  for r in select * from (values
    ('activity_log', 'see activity for visible homes', 'private.staff_for(builder_id)'),
    ('ai_allowances', 'see AI allowance', 'private.staff_for(builder_id)'),
    ('ai_credit_grants', 'see AI top-ups', 'private.staff_for(builder_id)'),
    ('ai_usage', 'see AI usage', 'private.staff_for(builder_id)'),
    ('builder_onboarding', 'our team sees onboarding', 'private.staff_for(builder_id)'),
    ('builder_settings', 'see builder settings', 'private.staff_for(builder_id)'),
    ('builder_tasks', 'see the builder''s to-dos', 'private.staff_for(builder_id)'),
    ('community_assignments', 'see own, or builder''s if owner/manager, or all if staff',
      'private.staff_for((select c.builder_id from public.communities c where c.id = community_assignments.community_id))'),
    ('comp_request_items', 'our team adds comps', 'private.staff_for((select r.builder_id from public.comp_requests r where r.id = comp_request_items.request_id))'),
    ('comp_request_items', 'our team changes comps', 'private.staff_for((select r.builder_id from public.comp_requests r where r.id = comp_request_items.request_id))'),
    ('comp_request_items', 'our team removes comps', 'private.staff_for((select r.builder_id from public.comp_requests r where r.id = comp_request_items.request_id))'),
    ('comp_requests', 'see comp requests', 'private.staff_for(builder_id)'),
    ('comp_requests', 'update comp requests', 'private.staff_for(builder_id)'),
    ('deliverable_files', 'our team delivers files', 'private.staff_for(builder_id)'),
    ('deliverable_files', 'our team trashes files', 'private.staff_for(builder_id)'),
    ('deliverable_files', 'see delivered files', 'private.staff_for(builder_id)'),
    ('floor_plans', 'add floor plans', 'private.staff_for(builder_id)'),
    ('floor_plans', 'change floor plans', 'private.staff_for(builder_id)'),
    ('floor_plans', 'see floor plans', 'private.staff_for(builder_id)'),
    ('home_alerts', 'see alerts', 'private.staff_for(builder_id)'),
    ('home_alerts', 'staff resolve alerts', 'private.staff_for(builder_id)'),
    ('incentives', 'see incentives', 'private.staff_for(builder_id)'),
    ('issue_reports', 'see your own reports, staff all', 'private.staff_for(builder_id)'),
    ('issue_reports', 'staff close reports', 'private.staff_for(builder_id)'),
    ('media_requests', 'see requests: staff all, builder their own, photographer their ', 'private.staff_for(builder_id)'),
    ('media_tag_requests', 'see own or all as staff', 'private.staff_for(builder_id)'),
    ('media_tag_requests', 'taggers ask for tags', 'private.staff_for(builder_id)'),
    ('mls_details', 'staff add MLS details', 'private.staff_for(builder_id)'),
    ('mls_details', 'staff and the builder see MLS details', 'private.staff_for(builder_id)'),
    ('mls_details', 'staff edit MLS details', 'private.staff_for(builder_id)'),
    ('mls_listings', 'see MLS data for your homes', 'private.staff_for(builder_id)'),
    ('profiles', 'see self, same company, or all if staff', 'private.staff_for(builder_id)'),
    ('reverse_prospect_requests', 'update reverse prospecting', 'private.staff_for(builder_id)'),
    ('share_link_events', 'see share link activity', 'private.staff_for(s.builder_id)'),
    ('share_links', 'see share links: builder leads, marketing, our staff', 'private.staff_for(builder_id)'),
    ('task_notes', 'staff add notes', 'private.staff_for((select t.builder_id from public.tasks t where t.id = task_notes.task_id))'),
    ('task_notes', 'staff see notes', 'private.staff_for((select t.builder_id from public.tasks t where t.id = task_notes.task_id))'),
    ('tasks', 'staff add tasks', 'private.staff_for(builder_id)'),
    ('tasks', 'staff see tasks', 'private.staff_for(builder_id)'),
    ('tasks', 'staff update tasks', 'private.staff_for(builder_id)'),
    ('website_listings', 'see website listings', 'private.staff_for(builder_id)')
  ) v(t, p, rep) loop
    select qual, with_check into q, c from pg_policies where schemaname = 'public' and tablename = r.t and policyname = r.p;
    if not found then
      raise exception 'staff_builders: rule "%" on % is missing; update this change', r.p, r.t;
    end if;
    if position('private.is_staff()' in coalesce(q, '') || coalesce(c, '')) = 0 then
      raise exception 'staff_builders: rule "%" on % no longer checks private.is_staff(); update this change', r.p, r.t;
    end if;
    execute format('alter policy %I on public.%I', r.p, r.t)
      || case when q is null then '' else ' using (' || replace(q, 'private.is_staff()', r.rep) || ')' end
      || case when c is null then '' else ' with check (' || replace(c, 'private.is_staff()', r.rep) || ')' end;
  end loop;
end $$;

-- 3. Homes: our staff edit only their builders' homes.
do $$
declare
  q text;
  c text;
  old_check constant text := '(private.my_role() = ANY (ARRAY[''platform_admin''::user_role, ''listing_coordinator''::user_role]))';
begin
  select qual, with_check into q, c from pg_policies where schemaname = 'public' and tablename = 'homes' and policyname = 'editors update homes';
  if position(old_check in coalesce(q, '')) = 0 or position(old_check in coalesce(c, '')) = 0 then
    raise exception 'staff_builders: "editors update homes" changed; update this change';
  end if;
  execute 'alter policy "editors update homes" on public.homes using ('
    || replace(q, old_check, 'private.staff_for(builder_id)') || ') with check ('
    || replace(c, old_check, 'private.staff_for(builder_id)') || ')';
end $$;
