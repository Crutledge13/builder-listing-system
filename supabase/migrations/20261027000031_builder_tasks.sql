-- A to-do board for each builder's own team (marketing first, plus owners and
-- managers), like our team's task board. Some tasks add themselves (photos
-- delivered and waiting for review, change requests; incentives ending, added
-- later) and close when the thing is done; people add and assign their own too.

create table public.builder_tasks (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  kind text not null default 'other' check (kind in ('photo_review', 'change_request', 'incentive', 'other')),
  title text not null check (length(trim(title)) between 1 and 200),
  details text check (length(details) <= 4000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  due_at timestamptz,
  assignee_id uuid references public.profiles(id),
  home_id uuid references public.homes(id) on delete cascade,
  community_id uuid references public.communities(id),
  source_table text,
  source_id uuid,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id)
);
create index builder_tasks_open on public.builder_tasks (builder_id, status, due_at) where status in ('todo', 'in_progress');
create index builder_tasks_source on public.builder_tasks (source_table, source_id);

-- Who works the board: the builder's owners, managers and marketing; our staff can look.
create or replace function private.on_builder_board(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id())
$$;
revoke all on function private.on_builder_board(uuid) from public, anon;
grant execute on function private.on_builder_board(uuid) to authenticated;

alter table public.builder_tasks enable row level security;
create policy "see the builder's to-dos" on public.builder_tasks for select to authenticated
  using (private.on_builder_board(builder_id) or private.is_staff());
create policy "add to-dos" on public.builder_tasks for insert to authenticated
  with check (private.on_builder_board(builder_id) and created_by = auth.uid());
create policy "work to-dos" on public.builder_tasks for update to authenticated
  using (private.on_builder_board(builder_id)) with check (private.on_builder_board(builder_id));

-- Keep it tidy: assignees must work the board for that builder; stamp who finished.
create or replace function public.builder_tasks_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.builder_id := old.builder_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source_table := old.source_table;
    new.source_id := old.source_id;
  end if;
  if new.home_id is not null and (select builder_id from public.homes where id = new.home_id) is distinct from new.builder_id then
    raise exception 'That home belongs to another builder';
  end if;
  if new.assignee_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id and p.is_active and p.builder_id = new.builder_id
      and p.role in ('builder_owner', 'manager', 'marketing')
  ) then
    raise exception 'Assign it to an owner, manager or marketing person at this builder';
  end if;
  if new.status in ('done', 'cancelled') and (tg_op = 'INSERT' or old.status not in ('done', 'cancelled')) then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif new.status in ('todo', 'in_progress') then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  new.updated_at := now();
  -- Tell someone when a to-do is handed to them by someone else.
  if new.assignee_id is not null and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform private.notify(new.assignee_id, 'task', 'New to-do for you: ' || new.title, new.details, '/todo');
  end if;
  return new;
end $$;
revoke all on function public.builder_tasks_prepare() from public, anon, authenticated;
create trigger builder_tasks_prepare before insert or update on public.builder_tasks
  for each row execute function public.builder_tasks_prepare();

create or replace function private.add_builder_task(p_builder uuid, p_kind text, p_title text, p_details text, p_home uuid, p_community uuid,
  p_source_table text, p_source_id uuid, p_due timestamptz, p_priority text default 'normal') returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  -- One open to-do per source.
  select id into tid from public.builder_tasks
  where source_table = p_source_table and source_id = p_source_id and status in ('todo', 'in_progress') limit 1;
  if tid is not null then return tid; end if;
  insert into public.builder_tasks (builder_id, kind, title, details, home_id, community_id, source_table, source_id, due_at, priority, created_by)
  values (p_builder, p_kind, left(p_title, 200), left(p_details, 4000), p_home, p_community, p_source_table, p_source_id, p_due, p_priority, null)
  returning id into tid;
  return tid;
end $$;
revoke all on function private.add_builder_task(uuid, text, text, text, uuid, uuid, text, uuid, timestamptz, text) from public, anon, authenticated;

create or replace function private.close_builder_tasks(p_source_table text, p_source_id uuid, p_status text default 'done') returns void
language sql security definer set search_path = '' as $$
  update public.builder_tasks set status = p_status
  where source_table = p_source_table and source_id = p_source_id and status in ('todo', 'in_progress')
$$;
revoke all on function private.close_builder_tasks(text, uuid, text) from public, anon, authenticated;

-- Photos delivered: someone at the builder checks them and marks the request complete or sends it back.
create or replace function public.media_requests_builder_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status <> 'delivered') then
    perform private.add_builder_task(new.builder_id, 'photo_review', 'Review the photos for ' || new.address,
      'The photographer delivered. Check the photos, then mark the request complete or send it back.'
        || coalesce(E'\n\nFrom the photographer: ' || new.photographer_note, ''),
      new.home_id, new.community_id, 'media_requests', new.id, now() + interval '2 days');
  elsif tg_op = 'UPDATE' and old.status = 'delivered' and new.status <> 'delivered' then
    perform private.close_builder_tasks('media_requests', new.id, case when new.status = 'cancelled' then 'cancelled' else 'done' end);
  end if;
  return new;
end $$;
revoke all on function public.media_requests_builder_tasks() from public, anon, authenticated;
create trigger media_requests_builder_tasks after insert or update of status on public.media_requests
  for each row execute function public.media_requests_builder_tasks();

-- Change requests: whoever handles them at the builder sees them on the board.
create or replace function public.change_requests_builder_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare addr text;
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    select unparsed_address into addr from public.homes where id = new.home_id;
    perform private.add_builder_task(new.builder_id, 'change_request', 'Change request: ' || coalesce(addr, 'a home'),
      new.message, new.home_id, null, 'change_requests', new.id, now() + interval '3 days');
  elsif tg_op = 'UPDATE' and new.status <> 'open' and old.status = 'open' then
    perform private.close_builder_tasks('change_requests', new.id, case when new.status = 'declined' then 'cancelled' else 'done' end);
  end if;
  return new;
end $$;
revoke all on function public.change_requests_builder_tasks() from public, anon, authenticated;
create trigger change_requests_builder_tasks after insert or update of status on public.change_requests
  for each row execute function public.change_requests_builder_tasks();

-- Start the board with what's already waiting.
insert into public.builder_tasks (builder_id, kind, title, details, home_id, community_id, source_table, source_id, due_at, created_by)
select r.builder_id, 'photo_review', 'Review the photos for ' || r.address,
  'The photographer delivered. Check the photos, then mark the request complete or send it back.',
  r.home_id, r.community_id, 'media_requests', r.id, coalesce(r.delivered_at, now()) + interval '2 days', null
from public.media_requests r where r.status = 'delivered';
insert into public.builder_tasks (builder_id, kind, title, details, home_id, source_table, source_id, due_at, created_by)
select c.builder_id, 'change_request', 'Change request: ' || coalesce(h.unparsed_address, 'a home'), c.message, c.home_id, 'change_requests', c.id, c.created_at + interval '3 days', null
from public.change_requests c left join public.homes h on h.id = c.home_id where c.status = 'open';
