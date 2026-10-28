-- Join links (owners, 28 Oct 2026): a link our admins make for one role (and
-- builder) that lets a person set up their own login, without an email
-- invite. They're in right away (owners' choice); anyone can be switched off
-- afterwards on Admin > People.
--
-- The join page (/join/[token]) is signed out, like the realtor share page. It
-- reads only through public.join_link_info(token). Logins are created on our
-- server with Supabase's admin key, then public.redeem_join_link (callable
-- only with that key, never by a browser) sets up the person.
--
-- A link can never make a platform admin. Builder roles need a builder;
-- our staff roles (listing coordinator, photographer) have none.

create table public.join_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_'),
  role public.user_role not null check (role <> 'platform_admin'),
  builder_id uuid references public.builders(id) on delete cascade,
  community_ids uuid[] not null default '{}',        -- sales: the communities they see
  staff_builder_ids uuid[] not null default '{}',    -- coordinators: the builders they work on (none = all)
  label text check (length(label) <= 120),
  expires_at timestamptz not null default now() + interval '30 days',
  max_uses int check (max_uses is null or max_uses between 1 and 500),
  use_count int not null default 0,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint join_links_builder check (
    (role in ('listing_coordinator', 'photographer') and builder_id is null)
    or (role not in ('listing_coordinator', 'photographer') and builder_id is not null)),
  constraint join_links_expiry check (expires_at <= created_at + interval '366 days')
);

alter table public.join_links enable row level security;
revoke all on public.join_links from anon;
create policy "admins see join links" on public.join_links
  for select to authenticated using (private.my_role() = 'platform_admin');
create policy "admins make join links" on public.join_links
  for insert to authenticated with check (private.my_role() = 'platform_admin');
create policy "admins change join links" on public.join_links
  for update to authenticated using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

-- Token, counts and who made it can't be set by people; only turning it off
-- (or back on) and the end date can change afterwards.
create or replace function public.join_links_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.token := replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
    new.use_count := 0;
    new.revoked_at := null;
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.expires_at <= now() then raise exception 'Pick an end date in the future'; end if;
    if new.role <> 'sales' then new.community_ids := '{}'; end if;
    if new.role <> 'listing_coordinator' then new.staff_builder_ids := '{}'; end if;
    if exists (select 1 from unnest(new.community_ids) c where c not in (select id from public.communities where builder_id = new.builder_id)) then
      raise exception 'Those communities aren''t this builder''s';
    end if;
  elsif current_setting('app.join_redeem', true) is distinct from 'on' then
    new.token := old.token;
    new.role := old.role;
    new.builder_id := old.builder_id;
    new.community_ids := old.community_ids;
    new.staff_builder_ids := old.staff_builder_ids;
    new.use_count := old.use_count;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger join_links_prepare before insert or update on public.join_links
  for each row execute function public.join_links_prepare();

-- What the signed-out join page may show about a link: the role and builder,
-- and whether it still works. Nothing else.
create or replace function public.join_link_info(p_token text)
returns table (ok boolean, reason text, role public.user_role, builder_name text)
language sql stable security definer set search_path = '' as $$
  select
    l.revoked_at is null and l.expires_at > now() and (l.max_uses is null or l.use_count < l.max_uses),
    case when l.revoked_at is not null then 'off'
         when l.expires_at <= now() then 'expired'
         when l.max_uses is not null and l.use_count >= l.max_uses then 'used' end,
    l.role,
    replace(b.name, ' (demo)', '')
  from public.join_links l
  left join public.builders b on b.id = l.builder_id
  where p_token is not null and length(p_token) >= 20 and l.token = p_token
$$;
revoke all on function public.join_link_info(text) from public;
grant execute on function public.join_link_info(text) to anon, authenticated;

-- Set up a person who just made a login through a join link. Only our server
-- calls this (with Supabase's admin key), right after creating the login.
create or replace function public.redeem_join_link(p_token text, p_user uuid, p_email text, p_name text, p_phone text default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare l public.join_links; name text := left(btrim(coalesce(p_name, '')), 120);
begin
  select * into l from public.join_links where token = p_token for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now()
     or (l.max_uses is not null and l.use_count >= l.max_uses) then
    raise exception 'This join link isn''t working anymore' using errcode = '42501';
  end if;
  if name = '' then raise exception 'Enter your name'; end if;
  if exists (select 1 from public.profiles where id = p_user or lower(email) = lower(p_email)) then
    raise exception 'That email already has an account' using errcode = '23505';
  end if;

  insert into public.profiles (id, email, full_name, role, builder_id, phone)
  values (p_user, lower(btrim(p_email)), name, l.role, l.builder_id, nullif(left(btrim(coalesce(p_phone, '')), 40), ''));

  if l.role = 'sales' and cardinality(l.community_ids) > 0 then
    insert into public.community_assignments (profile_id, community_id)
    select p_user, c from unnest(l.community_ids) c
    where c in (select id from public.communities where builder_id = l.builder_id);
  end if;
  if l.role = 'listing_coordinator' and cardinality(l.staff_builder_ids) > 0 then
    insert into public.staff_builders (profile_id, builder_id, created_by)
    select p_user, b, l.created_by from unnest(l.staff_builder_ids) b
    where b in (select id from public.builders);
  end if;

  -- Show who let them in on the access history, and count the use.
  update public.activity_log set actor_id = l.created_by, changes = changes || jsonb_build_object('via', 'join link', 'link', l.label)
  where action = 'person_added' and changes ->> 'person_id' = p_user::text;
  perform set_config('app.join_redeem', 'on', true);
  update public.join_links set use_count = use_count + 1 where id = l.id;
  perform set_config('app.join_redeem', 'off', true);

  if l.created_by is not null then
    perform private.notify(l.created_by, 'person_joined',
      name || ' joined with your join link',
      name || ' (' || lower(btrim(p_email)) || ') can now sign in' || coalesce(' with the link "' || l.label || '"', '') || '. Check their role and access on Admin > People.',
      '/admin/people');
  end if;
  return l.role::text;
end $$;
revoke all on function public.redeem_join_link(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_join_link(text, uuid, text, text, text) to service_role;
