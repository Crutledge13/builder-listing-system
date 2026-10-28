-- Fixes from the all-roles check on 28 Oct 2026.
--
-- 1. MLS markets and the market lock are set by our platform admins only
--    (Admin > Builders). The builder_settings policy lets a builder's owners,
--    managers and marketing change their row (website feed), so the guard that
--    already protects "who enters the MLS" and the feature switches now also
--    protects mls_boards and mls_locked.
--
-- 2. The yes/no permission helpers now always answer yes or no. Before, for
--    someone with no builder (a photographer) or someone just turned off, a
--    helper could answer "unknown" (null). A row-level rule treats unknown as
--    no, but a check written as `if not private.can_see_home(...)` doesn't
--    refuse on unknown, so a couple of functions let those people through
--    (the MLS readiness checklist for any home, and "Still available").
--    Who can do what is unchanged; the roles in each helper are the same.

create or replace function public.builder_settings_mls_entry_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and private.my_role() is distinct from 'platform_admin' then
    if new.mls_entry is distinct from (case when tg_op = 'UPDATE' then old.mls_entry else 'our_team' end) then
      raise exception 'Only our admins change who enters listings in the MLS' using errcode = '42501';
    end if;
    if new.features_off is distinct from (case when tg_op = 'UPDATE' then old.features_off else '{}'::text[] end) then
      raise exception 'Only our admins turn a builder''s features on or off' using errcode = '42501';
    end if;
    if new.mls_boards is distinct from (case when tg_op = 'UPDATE' then old.mls_boards else '{}'::text[] end)
       or new.mls_locked is distinct from (case when tg_op = 'UPDATE' then old.mls_locked else true end) then
      raise exception 'Only our admins change a builder''s MLS markets' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.builder_settings_mls_entry_guard() from public, anon, authenticated;

create or replace function private.can_see_builder(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff() or target = private.my_builder_id(), false)
$$;

create or replace function private.can_see_home(b uuid, c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff()
      or (b = private.my_builder_id()
          and (private.my_role() <> 'sales'
               or c in (select private.my_community_ids()))), false)
$$;

create or replace function private.can_see_media(b uuid, c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff()
      or (b = private.my_builder_id()
          and (private.my_role() <> 'sales' or c is null or c in (select private.my_community_ids()))), false)
$$;

create or replace function private.can_edit_branding(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id()), false)
$$;

create or replace function private.can_manage_media(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
      or (b = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')), false)
$$;

create or replace function private.can_share(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id()), false)
$$;

create or replace function private.on_builder_board(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id()), false)
$$;

create or replace function private.can_run_setup(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff()
      or (b = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')), false)
$$;

create or replace function private.can_manage_person(target_role public.user_role, target_builder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(target_builder is not null
     and target_builder = private.my_builder_id()
     and ((private.my_role() = 'builder_owner' and target_role in ('builder_owner', 'manager', 'sales', 'marketing'))
       or (private.my_role() in ('manager', 'marketing') and target_role in ('sales', 'marketing'))), false)
$$;

create or replace function private.can_work_mls(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff()
      or (b is not null and b = private.my_builder_id()
          and private.my_role() in ('builder_owner', 'manager', 'marketing')
          and private.builder_enters_mls(b)), false)
$$;

create or replace function private.can_use_builder_ai(p_builder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff()
      or (private.my_role() in ('builder_owner', 'manager', 'marketing', 'sales') and p_builder = private.my_builder_id())
      or (private.my_role() = 'photographer' and exists (
            select 1 from public.media_requests r where r.builder_id = p_builder and r.photographer_id = auth.uid())), false)
$$;
