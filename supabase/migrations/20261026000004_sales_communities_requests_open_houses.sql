-- Sales team view:
--  1. Salespeople see only the communities they're assigned to (and those homes).
--  2. Change requests on a home.
--  3. Open houses on a home.

-- ---------------------------------------------------------------------------
-- 1. Community assignments
-- ---------------------------------------------------------------------------
create table public.community_assignments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, community_id)
);
create index community_assignments_community_idx on public.community_assignments (community_id);

-- The person and the community must belong to the same builder.
create or replace function public.enforce_assignment_same_builder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p join public.communities c on c.builder_id = p.builder_id
    where p.id = new.profile_id and c.id = new.community_id
  ) then
    raise exception 'That person and community belong to different builders' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger community_assignments_same_builder
  before insert or update on public.community_assignments
  for each row execute function public.enforce_assignment_same_builder();

create or replace function private.my_community_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select community_id from public.community_assignments where profile_id = auth.uid()
$$;

-- Can the signed-in user see a home in this builder and community?
-- Staff: everything. Sales: only assigned communities. Other builder roles: their whole builder.
create or replace function private.can_see_home(b uuid, c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b = private.my_builder_id()
          and (private.my_role() <> 'sales'
               or c in (select private.my_community_ids())))
$$;

create or replace function private.can_see_community(b uuid, c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_see_home(b, c)
$$;

revoke execute on function private.my_community_ids(), private.can_see_home(uuid, uuid),
  private.can_see_community(uuid, uuid) from public, anon;
grant execute on function private.my_community_ids(), private.can_see_home(uuid, uuid),
  private.can_see_community(uuid, uuid) to authenticated;
revoke execute on function public.enforce_assignment_same_builder() from public, anon, authenticated;

alter table public.community_assignments enable row level security;
revoke all on public.community_assignments from anon;

create policy "see own, or builder's if owner/manager, or all if staff" on public.community_assignments
  for select to authenticated using (
    profile_id = auth.uid() or private.is_staff()
    or exists (select 1 from public.communities c
               where c.id = community_id and c.builder_id = private.my_builder_id()
                 and private.my_role() in ('builder_owner', 'manager')));
create policy "owners, managers and admin assign" on public.community_assignments
  for insert to authenticated with check (
    private.my_role() = 'platform_admin'
    or exists (select 1 from public.communities c
               where c.id = community_id and c.builder_id = private.my_builder_id()
                 and private.my_role() in ('builder_owner', 'manager')));
create policy "owners, managers and admin unassign" on public.community_assignments
  for delete to authenticated using (
    private.my_role() = 'platform_admin'
    or exists (select 1 from public.communities c
               where c.id = community_id and c.builder_id = private.my_builder_id()
                 and private.my_role() in ('builder_owner', 'manager')));

-- Tighten communities, homes and activity for sales.
alter policy "see own builder communities" on public.communities
  using (private.can_see_community(builder_id, id));
alter policy "see own builder communities" on public.communities rename to "see visible communities";

alter policy "see own builder homes" on public.homes
  using (private.can_see_home(builder_id, community_id));
alter policy "see own builder homes" on public.homes rename to "see visible homes";

alter policy "builder editors add homes" on public.homes
  with check (private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'sales')
        and private.can_see_home(builder_id, community_id)
        and workflow_status = 'draft'
        and mls_number is null
        and deleted_at is null));

alter policy "editors update homes" on public.homes
  using (private.my_role() in ('platform_admin', 'listing_coordinator')
    or (private.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and private.can_see_home(builder_id, community_id)))
  with check (private.my_role() in ('platform_admin', 'listing_coordinator')
    or (private.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and private.can_see_home(builder_id, community_id)));

alter policy "see own builder activity" on public.activity_log
  using (
    private.can_see_builder(builder_id)
    and (home_id is null or exists (select 1 from public.homes h where h.id = activity_log.home_id)));
alter policy "see own builder activity" on public.activity_log rename to "see activity for visible homes";

-- Helper for logging from other tables' triggers.
create or replace function private.log_activity(p_home uuid, p_action text, p_changes jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
  select h.builder_id, h.id, auth.uid(), p_action, p_changes from public.homes h where h.id = p_home
$$;
revoke execute on function private.log_activity(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Change requests
-- ---------------------------------------------------------------------------
create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id) on delete cascade,
  builder_id uuid not null references public.builders (id),
  requested_by uuid not null references auth.users (id),
  message text not null check (length(trim(message)) > 0),
  status text not null default 'open' check (status in ('open', 'done', 'declined')),
  resolution_note text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index change_requests_home_idx on public.change_requests (home_id, created_at desc);
create index change_requests_open_idx on public.change_requests (builder_id) where status = 'open';

create or replace function public.change_requests_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.builder_id := (select builder_id from public.homes where id = new.home_id);
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.status := 'open';
    new.resolved_by := null; new.resolved_at := null; new.resolution_note := null;
    perform private.log_activity(new.home_id, 'change_requested', jsonb_build_object('message', new.message));
    return new;
  end if;
  -- Updates may only resolve the request.
  if new.home_id <> old.home_id or new.builder_id <> old.builder_id
     or new.requested_by <> old.requested_by or new.message <> old.message
     or new.created_at <> old.created_at then
    raise exception 'Only the status of a request can be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
    new.resolved_at := case when new.status = 'open' then null else now() end;
    perform private.log_activity(new.home_id, 'change_request_' || new.status,
      jsonb_build_object('message', new.message, 'note', new.resolution_note));
  end if;
  return new;
end $$;
revoke execute on function public.change_requests_guard() from public, anon, authenticated;
create trigger change_requests_guard
  before insert or update on public.change_requests
  for each row execute function public.change_requests_guard();

alter table public.change_requests enable row level security;
revoke all on public.change_requests from anon;

create policy "see requests on visible homes" on public.change_requests
  for select to authenticated using (exists (select 1 from public.homes h where h.id = home_id));
create policy "anyone who sees the home can request" on public.change_requests
  for insert to authenticated with check (exists (select 1 from public.homes h where h.id = home_id));
create policy "owners, managers, marketing and admin resolve" on public.change_requests
  for update to authenticated
  using (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing')
         and exists (select 1 from public.homes h where h.id = home_id))
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing'));

-- ---------------------------------------------------------------------------
-- 3. Open houses (RESO OpenHouse resource names in comments)
-- ---------------------------------------------------------------------------
create table public.open_houses (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id) on delete cascade,
  builder_id uuid not null references public.builders (id),
  starts_at timestamptz not null,   -- RESO OpenHouseStartTime
  ends_at timestamptz not null,     -- RESO OpenHouseEndTime
  remarks text,                     -- RESO OpenHouseRemarks
  created_by uuid not null references auth.users (id),
  cancelled_at timestamptz,         -- cancelled, not deleted
  created_at timestamptz not null default now(),
  constraint open_house_times check (ends_at > starts_at)
);
create index open_houses_home_idx on public.open_houses (home_id, starts_at);
create index open_houses_upcoming_idx on public.open_houses (builder_id, starts_at) where cancelled_at is null;

create or replace function public.open_houses_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.builder_id := (select builder_id from public.homes where id = new.home_id);
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.cancelled_at := null;
    perform private.log_activity(new.home_id, 'open_house_scheduled',
      jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at));
    return new;
  end if;
  if new.home_id <> old.home_id or new.builder_id <> old.builder_id or new.created_by <> old.created_by then
    raise exception 'That change isn''t allowed on an open house' using errcode = '42501';
  end if;
  if new.cancelled_at is not null and old.cancelled_at is null then
    perform private.log_activity(new.home_id, 'open_house_cancelled',
      jsonb_build_object('starts_at', old.starts_at, 'ends_at', old.ends_at));
  end if;
  return new;
end $$;
revoke execute on function public.open_houses_guard() from public, anon, authenticated;
create trigger open_houses_guard
  before insert or update on public.open_houses
  for each row execute function public.open_houses_guard();

alter table public.open_houses enable row level security;
revoke all on public.open_houses from anon;

create policy "see open houses on visible homes" on public.open_houses
  for select to authenticated using (exists (select 1 from public.homes h where h.id = home_id));
create policy "sales, managers, owners and admin schedule" on public.open_houses
  for insert to authenticated with check (
    private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales')
    and exists (select 1 from public.homes h where h.id = home_id));
create policy "sales, managers, owners and admin change" on public.open_houses
  for update to authenticated
  using (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales')
         and exists (select 1 from public.homes h where h.id = home_id))
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'sales'));
-- No delete policies: requests and open houses are kept for the record.
