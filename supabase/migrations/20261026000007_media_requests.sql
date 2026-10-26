-- Media requests: the builder's team asks for photos/video of a home (or a
-- whole community), our admins assign a photographer, the photographer uploads
-- and marks it delivered, and the builder marks it complete.
--
-- Photographers see only their assigned jobs. The job carries a copy of the
-- address and community name, so photographers never need access to homes,
-- prices or anything else.

create table public.media_requests (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  community_id uuid not null references public.communities (id),
  home_id uuid references public.homes (id),          -- null = whole community
  needs text[] not null default '{}' check (needs <@ array['photos', 'twilight', 'video', 'drone', 'floor_plan', 'virtual_tour']),
  notes text,
  due_date date,
  status text not null default 'requested'
    check (status in ('requested', 'assigned', 'scheduled', 'delivered', 'completed', 'cancelled')),
  photographer_id uuid references public.profiles (id),
  photographer_name text,                              -- copy, for builders who can't see our contractors
  scheduled_for timestamptz,
  photographer_note text,
  address text not null,                               -- copy, for the photographer
  community_name text not null,                        -- copy, for the photographer
  builder_name text not null,                          -- copy, for the photographer
  requested_by uuid not null references auth.users (id),
  requester_name text,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_requests_builder_idx on public.media_requests (builder_id, status);
create index media_requests_home_idx on public.media_requests (home_id);
create index media_requests_photographer_idx on public.media_requests (photographer_id, status);

-- Jobs a photographer may currently upload to.
create or replace function private.my_open_job_homes()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select home_id from public.media_requests
  where photographer_id = auth.uid() and home_id is not null
    and status in ('assigned', 'scheduled', 'delivered')
$$;
create or replace function private.my_open_job_communities()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select community_id from public.media_requests
  where photographer_id = auth.uid() and home_id is null
    and status in ('assigned', 'scheduled', 'delivered')
$$;
revoke execute on function private.my_open_job_homes(), private.my_open_job_communities() from public, anon;
grant execute on function private.my_open_job_homes(), private.my_open_job_communities() to authenticated;

create or replace function public.media_requests_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role := private.my_role();
  h record;
  c record;
  b record;
begin
  if tg_op = 'INSERT' then
    if new.home_id is not null then
      select id, builder_id, community_id, unparsed_address, city into h from public.homes where id = new.home_id;
      if h.id is null then raise exception 'Unknown home'; end if;
      new.builder_id := h.builder_id;
      new.community_id := h.community_id;
      new.address := h.unparsed_address || ', ' || h.city;
    end if;
    select id, builder_id, name, city into c from public.communities where id = new.community_id;
    if c.id is null then raise exception 'Unknown community'; end if;
    new.builder_id := c.builder_id;
    new.community_name := c.name;
    if new.home_id is null then new.address := c.name || ' (whole community), ' || c.city; end if;
    select name into b from public.builders where id = c.builder_id;
    new.builder_name := b.name;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.requester_name := (select full_name from public.profiles where id = new.requested_by);
    if r is distinct from 'platform_admin' then
      new.status := 'requested';
      new.photographer_id := null;
      new.scheduled_for := null;
    end if;
    if new.photographer_id is not null then
      new.photographer_name := (select full_name from public.profiles where id = new.photographer_id and role = 'photographer');
      if new.photographer_name is null then raise exception 'That person isn''t a photographer'; end if;
      if new.status = 'requested' then new.status := 'assigned'; end if;
    end if;
    perform private.log_activity(new.home_id, 'media_requested', jsonb_build_object('needs', new.needs));
    return new;
  end if;

  -- Never changeable.
  if new.builder_id <> old.builder_id or new.community_id <> old.community_id
     or new.home_id is distinct from old.home_id or new.requested_by <> old.requested_by
     or new.created_at <> old.created_at then
    raise exception 'That can''t be changed on a request' using errcode = '42501';
  end if;

  if auth.uid() is not null and r <> 'platform_admin' then
    if r = 'photographer' then
      -- Photographers: schedule, add a note, mark delivered.
      if new.needs <> old.needs or new.notes is distinct from old.notes or new.due_date is distinct from old.due_date
         or new.photographer_id is distinct from old.photographer_id then
        raise exception 'Photographers can only schedule, add a note and mark a job delivered' using errcode = '42501';
      end if;
      if new.status <> old.status and not (
           (old.status in ('assigned', 'scheduled') and new.status in ('scheduled', 'delivered'))
        or (old.status = 'delivered' and new.status = 'scheduled')) then
        raise exception 'Photographers can''t move a job from % to %', old.status, new.status using errcode = '42501';
      end if;
    else
      -- Builder team: edit while still requested, cancel, or mark a delivery complete.
      if new.photographer_id is distinct from old.photographer_id or new.scheduled_for is distinct from old.scheduled_for
         or new.photographer_note is distinct from old.photographer_note then
        raise exception 'Our team assigns and schedules photographers' using errcode = '42501';
      end if;
      if (new.needs <> old.needs or new.notes is distinct from old.notes or new.due_date is distinct from old.due_date)
         and old.status not in ('requested', 'assigned', 'scheduled') then
        raise exception 'This request can''t be edited any more' using errcode = '42501';
      end if;
      if new.status <> old.status and not (
           (new.status = 'cancelled' and old.status not in ('completed', 'cancelled'))
        or (new.status = 'completed' and old.status = 'delivered')
        or (new.status = 'scheduled' and old.status = 'delivered')) then   -- "needs another pass"
        raise exception 'You can''t move a request from % to %', old.status, new.status using errcode = '42501';
      end if;
    end if;
  end if;

  if new.photographer_id is distinct from old.photographer_id then
    new.photographer_name := (select full_name from public.profiles where id = new.photographer_id and role = 'photographer');
    if new.photographer_id is not null and new.photographer_name is null then raise exception 'That person isn''t a photographer'; end if;
    if new.photographer_id is not null and new.status = 'requested' then new.status := 'assigned'; end if;
    if new.photographer_id is null and new.status in ('assigned', 'scheduled') then new.status := 'requested'; end if;
  end if;
  if new.scheduled_for is not null and old.scheduled_for is null and new.status = 'assigned' then
    new.status := 'scheduled';
  end if;
  if new.status = 'delivered' and old.status <> 'delivered' then new.delivered_at := now(); end if;
  if new.status = 'completed' and old.status <> 'completed' then new.completed_at := now(); end if;
  new.updated_at := now();

  if new.status <> old.status then
    perform private.log_activity(new.home_id, 'media_request_' || new.status,
      jsonb_build_object('photographer', new.photographer_name));
  elsif new.photographer_id is distinct from old.photographer_id then
    perform private.log_activity(new.home_id, 'media_request_assigned', jsonb_build_object('photographer', new.photographer_name));
  end if;
  return new;
end $$;
revoke execute on function public.media_requests_guard() from public, anon, authenticated;
create trigger media_requests_guard
  before insert or update on public.media_requests
  for each row execute function public.media_requests_guard();

alter table public.media_requests enable row level security;
revoke all on public.media_requests from anon;

create policy "see requests: staff all, builder their own, photographer their jobs" on public.media_requests
  for select to authenticated using (
    private.is_staff()
    or photographer_id = auth.uid()
    or (builder_id = private.my_builder_id()
        and (private.my_role() <> 'sales' or community_id in (select private.my_community_ids()))));
create policy "builder team and admins request" on public.media_requests
  for insert to authenticated with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and builder_id = private.my_builder_id()
        and (private.my_role() <> 'sales' or community_id in (select private.my_community_ids()))));
create policy "update requests" on public.media_requests
  for update to authenticated
  using (
    private.my_role() = 'platform_admin'
    or photographer_id = auth.uid()
    or (private.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and builder_id = private.my_builder_id()
        and (private.my_role() <> 'sales' or community_id in (select private.my_community_ids()))))
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() = 'photographer' and photographer_id = auth.uid())
    or (private.my_role() in ('builder_owner', 'manager', 'sales', 'marketing') and builder_id = private.my_builder_id()));

-- The log helper skips community-wide requests (no home), so make it tolerate null.
create or replace function private.log_activity(p_home uuid, p_action text, p_changes jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
  select h.builder_id, h.id, auth.uid(), p_action, p_changes from public.homes h where h.id = p_home
$$;

-- ---------------------------------------------------------------------------
-- Media: photographers can see and add media only on their open jobs, and
-- edit only what they uploaded.
-- ---------------------------------------------------------------------------
create or replace function private.can_see_media(b uuid, c uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b = private.my_builder_id()
          and (private.my_role() <> 'sales' or c is null or c in (select private.my_community_ids())))
$$;

create or replace function private.photographer_can_shoot(c uuid, h uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'photographer'
     and ((h is not null and h in (select private.my_open_job_homes()))
       or (h is null and c in (select private.my_open_job_communities())))
$$;
revoke execute on function private.photographer_can_shoot(uuid, uuid) from public, anon;
grant execute on function private.photographer_can_shoot(uuid, uuid) to authenticated;

alter policy "see visible media" on public.media
  using (
    private.can_see_media(builder_id, community_id)
    or (private.my_role() = 'photographer'
        and (uploaded_by = auth.uid()
             or home_id in (select private.my_open_job_homes())
             or (home_id is null and community_id in (select private.my_open_job_communities())))));

alter policy "media managers add" on public.media
  with check (private.can_manage_media(builder_id) or private.photographer_can_shoot(community_id, home_id));

alter policy "media managers edit" on public.media
  using (private.can_manage_media(builder_id) or (private.my_role() = 'photographer' and uploaded_by = auth.uid()))
  with check (private.can_manage_media(builder_id) or (private.my_role() = 'photographer' and uploaded_by = auth.uid()));

-- Storage: photographers upload into the folder of a home (or community) on an open job.
-- Folder layout: builder/community/home-or-"community"/file
alter policy "media files: upload into your builder's folder" on storage.objects
  with check (
    bucket_id = 'media'
    and (private.my_role() = 'platform_admin'
         or (private.my_role() in ('builder_owner', 'manager', 'marketing')
             and (storage.foldername(name))[1] = private.my_builder_id()::text)
         or (private.my_role() = 'photographer'
             and ((storage.foldername(name))[3] in (select h::text from private.my_open_job_homes() h)
                  or ((storage.foldername(name))[3] = 'community'
                      and (storage.foldername(name))[2] in (select c::text from private.my_open_job_communities() c))))));
