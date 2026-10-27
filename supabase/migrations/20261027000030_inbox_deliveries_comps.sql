-- 1. An inbox in the app: notices to one person ("your list is ready").
-- 2. Delivered files (reverse prospecting lists, comps) in a private bucket.
-- 3. Reverse prospecting lists go back to the person who asked.
-- 4. Comp requests: sales, marketing, owners and managers ask; our team pulls
--    comps from the MLS and sends them back as a table and/or a file.

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null check (length(title) <= 200),
  body text check (length(body) <= 2000),
  href text check (href ~ '^/'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "see your own notices" on public.notifications for select to authenticated using (user_id = auth.uid());
-- Written only by the database; read status changes through mark_notifications_read.

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- One notice to one active person.
create or replace function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_href text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select p.id, p_kind, left(p_title, 200), left(p_body, 2000), p_href from public.profiles p where p.id = p_user and p.is_active
$$;
revoke all on function private.notify(uuid, text, text, text, text) from public, anon, authenticated;

-- A notice to everyone at a builder with one of these roles (salespeople only
-- if they're assigned to the community, when one is given).
create or replace function private.notify_builder(p_builder uuid, p_roles text[], p_community uuid, p_kind text, p_title text, p_body text, p_href text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select p.id, p_kind, left(p_title, 200), left(p_body, 2000), p_href
  from public.profiles p
  where p.builder_id = p_builder and p.is_active and p.role::text = any(p_roles)
    and (p.role <> 'sales' or p_community is null
         or exists (select 1 from public.community_assignments a where a.profile_id = p.id and a.community_id = p_community))
$$;
revoke all on function private.notify_builder(uuid, text[], uuid, text, text, text, text) from public, anon, authenticated;

-- An email to one person (sent by our server through Resend once it's set up).
create or replace function private.queue_email_to(p_user uuid, p_subject text, p_body text, p_table text, p_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.email_outbox (to_email, subject, body, related_table, related_id)
  select p.email, p_subject, p_body, p_table, p_id from public.profiles p where p.id = p_user and p.is_active and p.email is not null
$$;
revoke all on function private.queue_email_to(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Comp requests
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('mls_entry', 'mls_update', 'open_house_mls', 'change_request', 'photo_request',
  'reverse_prospecting', 'comps', 'listing_status', 'issue', 'other'));

create table public.comp_requests (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  community_id uuid references public.communities(id),
  home_id uuid references public.homes(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  requester_name text,
  location text not null check (length(trim(location)) between 1 and 300),  -- address or area
  city text check (length(city) <= 80),
  price_point numeric check (price_point >= 0),
  living_area int check (living_area > 0),
  bedrooms int check (bedrooms between 0 and 20),
  bathrooms numeric(3,1) check (bathrooms between 0 and 20),
  stories int check (stories between 1 and 5),
  year_built int check (year_built between 1900 and 2100),
  comp_type text not null default 'both' check (comp_type in ('new', 'resale', 'both')),
  radius_miles numeric check (radius_miles between 0.1 and 50),
  months_back int check (months_back between 1 and 36),
  notes text check (length(notes) <= 2000),
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'delivered', 'cancelled')),
  result_note text check (length(result_note) <= 4000),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comp_requests_builder on public.comp_requests (builder_id, created_at desc);

alter table public.comp_requests enable row level security;
-- Our staff: all. Owners, managers, marketing: their company's. Sales: their own
-- requests and those for communities they're assigned to.
create policy "see comp requests" on public.comp_requests for select to authenticated using (
  private.is_staff()
  or (builder_id = private.my_builder_id() and (
        private.my_role() in ('builder_owner', 'manager', 'marketing')
        or requested_by = auth.uid()
        or (community_id is not null and private.can_see_community(builder_id, community_id))))
);
create policy "ask for comps" on public.comp_requests for insert to authenticated with check (
  requested_by = auth.uid()
  and (private.my_role() = 'platform_admin'
       or (private.my_role() in ('builder_owner', 'manager', 'marketing', 'sales') and builder_id = private.my_builder_id()))
  and (community_id is null or private.can_see_community(builder_id, community_id))
);
create policy "update comp requests" on public.comp_requests for update to authenticated
  using (private.is_staff() or requested_by = auth.uid() or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager')))
  with check (private.is_staff() or builder_id = private.my_builder_id());

create table public.comp_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.comp_requests(id) on delete cascade,
  address text not null check (length(trim(address)) between 1 and 200),
  status text check (status in ('Sold', 'Active', 'Pending', 'Expired', 'Withdrawn')),
  list_price numeric check (list_price >= 0),
  sold_price numeric check (sold_price >= 0),
  close_date date,
  living_area int check (living_area > 0),
  bedrooms int,
  bathrooms numeric(3,1),
  year_built int,
  days_on_market int check (days_on_market >= 0),
  distance_miles numeric check (distance_miles >= 0),
  notes text check (length(notes) <= 500),
  source text not null default 'mls' check (source in ('mls', 'staff')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index comp_request_items_request on public.comp_request_items (request_id);
alter table public.comp_request_items enable row level security;
create policy "see comps you can see the request of" on public.comp_request_items for select to authenticated
  using (exists (select 1 from public.comp_requests r where r.id = request_id));
create policy "our team adds comps" on public.comp_request_items for insert to authenticated with check (private.is_staff());
create policy "our team changes comps" on public.comp_request_items for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "our team removes comps" on public.comp_request_items for delete to authenticated using (private.is_staff());

-- Fill the builder, community and names; only our team moves a request along.
create or replace function public.comp_requests_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; c record;
begin
  if tg_op = 'INSERT' then
    if new.home_id is not null then
      select id, builder_id, community_id, unparsed_address, city into h from public.homes where id = new.home_id;
      if h.id is null then raise exception 'Unknown home'; end if;
      new.builder_id := h.builder_id;
      new.community_id := h.community_id;
    end if;
    if new.community_id is not null then
      select id, builder_id, city into c from public.communities where id = new.community_id;
      if c.id is null then raise exception 'Unknown community'; end if;
      new.builder_id := c.builder_id;
      new.city := coalesce(nullif(trim(new.city), ''), c.city);
    end if;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.requester_name := (select full_name from public.profiles where id = new.requested_by);
    new.status := 'requested';
    new.result_note := null;
    new.delivered_at := null;
    return new;
  end if;
  new.builder_id := old.builder_id;
  new.requested_by := old.requested_by;
  if not private.is_staff() and auth.uid() is not null then
    if new.status <> old.status and not (new.status = 'cancelled' and old.status = 'requested') then
      raise exception 'Our team updates comp requests' using errcode = '42501';
    end if;
    if new.result_note is distinct from old.result_note then
      raise exception 'Our team updates comp requests' using errcode = '42501';
    end if;
  end if;
  if new.status = 'delivered' and old.status <> 'delivered' then new.delivered_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.comp_requests_guard() from public, anon, authenticated;
create trigger comp_requests_guard before insert or update on public.comp_requests
  for each row execute function public.comp_requests_guard();

create or replace function public.comp_requests_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b text; what text;
begin
  select name into b from public.builders where id = new.builder_id;
  what := new.location || coalesce(', ' || new.city, '');
  if tg_op = 'INSERT' then
    perform private.add_task('comps', 'Pull comps for ' || what,
      'Requested by ' || coalesce(new.requester_name, 'the builder') || ' (' || coalesce(b, '') || ').'
        || coalesce(E'\nPrice point: $' || to_char(new.price_point, 'FM999,999,999'), '')
        || coalesce(E'\nSize: ' || new.living_area || ' sq ft', '')
        || coalesce(E'\nBeds/baths: ' || new.bedrooms || ' / ' || new.bathrooms, '')
        || coalesce(E'\nNotes: ' || new.notes, ''),
      new.home_id, new.community_id, new.builder_id, 'comp_requests', new.id, now() + interval '2 days', 'normal');
    perform private.queue_team_email('Comp request: ' || what,
      coalesce(new.requester_name, 'Someone') || ' at ' || coalesce(b, 'a builder') || ' asked for comps for ' || what || '.'
        || coalesce(E'\n\nNotes: ' || new.notes, '') || E'\n\nIt''s on the task board.',
      'comp_requests', new.id);
    if new.home_id is not null then perform private.log_activity(new.home_id, 'comps_requested', '{}'::jsonb); end if;
  elsif new.status <> old.status then
    if new.status = 'delivered' then
      perform private.close_tasks('comp_requests', new.id);
      perform private.notify(new.requested_by, 'comps', 'Your comps are ready: ' || what, new.result_note, '/comps/' || new.id);
      perform private.queue_email_to(new.requested_by, 'Your comps are ready: ' || what,
        'Our team pulled the comps you asked for (' || what || ').' || coalesce(E'\n\n' || new.result_note, '')
          || E'\n\nSee them in Builder Listings under Comps.', 'comp_requests', new.id);
    elsif new.status = 'cancelled' then perform private.close_tasks('comp_requests', new.id, null, 'cancelled');
    end if;
    if new.home_id is not null then perform private.log_activity(new.home_id, 'comps_' || new.status, '{}'::jsonb); end if;
  end if;
  return new;
end $$;
revoke all on function public.comp_requests_after() from public, anon, authenticated;
create trigger comp_requests_after after insert or update on public.comp_requests
  for each row execute function public.comp_requests_after();

-- ---------------------------------------------------------------------------
-- Delivered files
-- ---------------------------------------------------------------------------
create table public.deliverable_files (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  request_table text not null check (request_table in ('reverse_prospect_requests', 'comp_requests')),
  request_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (length(file_name) <= 200),
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index deliverable_files_request on public.deliverable_files (request_table, request_id);

-- Can the person asking see this request? (Runs as them, so the request's own rules decide.)
create or replace function private.request_visible(p_table text, p_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select case p_table
    when 'reverse_prospect_requests' then exists (select 1 from public.reverse_prospect_requests r where r.id = p_id)
    when 'comp_requests' then exists (select 1 from public.comp_requests r where r.id = p_id)
    else false end
$$;

alter table public.deliverable_files enable row level security;
create policy "see delivered files" on public.deliverable_files for select to authenticated
  using (private.is_staff() or (deleted_at is null and private.request_visible(request_table, request_id)));
create policy "our team delivers files" on public.deliverable_files for insert to authenticated with check (private.is_staff());
create policy "our team trashes files" on public.deliverable_files for update to authenticated using (private.is_staff()) with check (private.is_staff());

-- The builder comes from the request.
create or replace function public.deliverable_files_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.builder_id := case new.request_table
    when 'reverse_prospect_requests' then (select builder_id from public.reverse_prospect_requests where id = new.request_id)
    when 'comp_requests' then (select builder_id from public.comp_requests where id = new.request_id) end;
  if new.builder_id is null then raise exception 'Unknown request'; end if;
  if split_part(new.storage_path, '/', 1) <> new.builder_id::text then raise exception 'The file must be in this builder''s folder'; end if;
  return new;
end $$;
revoke all on function public.deliverable_files_prepare() from public, anon, authenticated;
create trigger deliverable_files_prepare before insert on public.deliverable_files
  for each row execute function public.deliverable_files_prepare();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('deliverables', 'deliverables', false, 52428800, array[
    'application/pdf', 'text/csv', 'text/plain', 'application/zip',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "deliverables: our team uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'deliverables' and private.is_staff());
create policy "deliverables: see if you can see the file" on storage.objects
  for select to authenticated using (bucket_id = 'deliverables' and exists (select 1 from public.deliverable_files f where f.storage_path = objects.name));

-- ---------------------------------------------------------------------------
-- Reverse prospecting: the finished list goes back to whoever asked.
-- ---------------------------------------------------------------------------
do $$ declare d text; begin
  d := pg_get_functiondef('public.reverse_prospect_after'::regproc);
  d := replace(d, $x$    if new.status = 'delivered' then perform private.close_tasks('reverse_prospect_requests', new.id);$x$,
    $x$    if new.status = 'delivered' then
      perform private.close_tasks('reverse_prospect_requests', new.id);
      perform private.notify(new.requested_by, 'reverse_prospecting', 'Your reverse prospecting list is ready: ' || new.address,
        new.result_note, '/homes/' || new.home_id || '#reverse-prospecting');
      perform private.queue_email_to(new.requested_by, 'Your reverse prospecting list is ready: ' || new.address,
        'Our team finished the reverse prospecting list you asked for (' || new.address || ').' || coalesce(E'\n\n' || new.result_note, '')
          || E'\n\nOpen the home in Builder Listings to download it.', 'reverse_prospect_requests', new.id);$x$);
  if position('Your reverse prospecting list is ready' in d) = 0 then raise exception 'reverse_prospect_after: pattern not found'; end if;
  execute d;
end $$;
