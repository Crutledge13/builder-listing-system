-- Approved email domains per builder (owners, 29 Oct 2026): nobody can be set
-- up at a builder unless their email matches the builder's own domain (what
-- they use for all their emails), so nobody sneaks in through a join link or a
-- mistyped invite. When someone else needs access (an outside marketing
-- agency, a salesperson on gmail), our platform admins approve it here: either
-- another domain for the builder, or one exact email address. Personal email
-- providers (gmail, yahoo...) can only be approved address by address, so
-- approving one person never lets in everyone on gmail.
--
-- A builder with no approved domains yet isn't checked (so builders set up
-- before this keep working); Admin shows them as "not locked".

create table public.builder_email_domains (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id) on delete cascade,
  value text not null check (value = lower(btrim(value)) and length(value) between 3 and 254),
  kind text not null check (kind in ('domain', 'address')),
  reason text check (length(reason) <= 300),     -- why an extra domain or address was approved
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id),
  check ((kind = 'domain' and value ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
      or (kind = 'address' and value ~ '^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'))
);
create unique index builder_email_domains_live on public.builder_email_domains (builder_id, value) where removed_at is null;
create index builder_email_domains_builder on public.builder_email_domains (builder_id) where removed_at is null;

-- Email services anyone can sign up for: approve these one address at a time.
create or replace function private.is_personal_email_domain(p_domain text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(lower(p_domain) = any (array[
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com',
    'att.net', 'sbcglobal.net', 'bellsouth.net', 'comcast.net', 'verizon.net', 'cox.net', 'charter.net', 'earthlink.net']), false)
$$;

create or replace function public.builder_email_domains_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.value := lower(btrim(regexp_replace(new.value, '^@', '')));
    new.kind := case when position('@' in new.value) > 0 then 'address' else 'domain' end;
    if new.kind = 'domain' and private.is_personal_email_domain(new.value) then
      raise exception '% is a personal email service anyone can sign up for. Approve the person''s exact email address instead.', new.value
        using errcode = '23514';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.removed_at := null;
    new.removed_by := null;
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_domain_added', jsonb_build_object('value', new.value, 'kind', new.kind, 'reason', new.reason));
    return new;
  end if;
  -- Only "remove" is a change; the rest stays as it was approved.
  if new.builder_id <> old.builder_id or new.value <> old.value or new.kind <> old.kind
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'Remove it and add a new one instead' using errcode = '42501';
  end if;
  if new.removed_at is not null and old.removed_at is null then
    new.removed_by := auth.uid();
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_domain_removed', jsonb_build_object('value', new.value, 'kind', new.kind));
  elsif new.removed_at is null and old.removed_at is not null then
    raise exception 'Add it again instead' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.builder_email_domains_prepare() from public, anon, authenticated;
create trigger builder_email_domains_prepare before insert or update on public.builder_email_domains
  for each row execute function public.builder_email_domains_prepare();

alter table public.builder_email_domains enable row level security;
revoke all on public.builder_email_domains from anon;
-- Our staff for that builder, and the builder's own people who add teammates,
-- can see the list (so the Team page can say whose emails work).
create policy "see approved domains" on public.builder_email_domains for select to authenticated using (
  private.staff_for(builder_id)
  or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing'))
);
create policy "platform admins approve domains" on public.builder_email_domains for insert to authenticated
  with check (private.my_role() = 'platform_admin');
create policy "platform admins remove domains" on public.builder_email_domains for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');
-- No deletes: removing sets removed_at, so the history stays.

-- Does this email fit the builder's approved domains? True when the builder
-- hasn't set any yet.
create or replace function private.email_allowed_for_builder(p_builder uuid, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    not exists (select 1 from public.builder_email_domains d where d.builder_id = p_builder and d.removed_at is null)
    or exists (
      select 1 from public.builder_email_domains d
      where d.builder_id = p_builder and d.removed_at is null
        and ((d.kind = 'domain' and lower(split_part(btrim(p_email), '@', 2)) = d.value)
          or (d.kind = 'address' and lower(btrim(p_email)) = d.value))),
    false)
$$;
revoke execute on function private.email_allowed_for_builder(uuid, text) from public, anon;

-- The lock itself: every way a builder person is added or changed (invites, the
-- Team page, join links, moving someone to another builder, changing their
-- sign-in email) goes through profiles.
create or replace function public.profiles_email_domain_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.builder_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.builder_id is not distinct from old.builder_id
     and lower(new.email) is not distinct from lower(old.email) then
    return new;
  end if;
  if not private.email_allowed_for_builder(new.builder_id, new.email) then
    raise exception 'Email domain not approved: % isn''t an approved email for this builder. Ask Builder Listing Services to approve it.', new.email
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_email_domain_check() from public, anon, authenticated;
create trigger profiles_email_domain_check before insert or update of email, builder_id on public.profiles
  for each row execute function public.profiles_email_domain_check();

-- For screens: whether an email would be accepted, checked before a login is
-- made (so a refused invite doesn't leave a half-made login behind) and before
-- someone changes their own sign-in email. Our staff for that builder, or
-- anyone at that builder.
create or replace function public.email_allowed(p_builder uuid, p_email text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.staff_for(p_builder) or p_builder = private.my_builder_id(), false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return private.email_allowed_for_builder(p_builder, p_email);
end $$;
revoke execute on function public.email_allowed(uuid, text) from public, anon;
grant execute on function public.email_allowed(uuid, text) to authenticated;
