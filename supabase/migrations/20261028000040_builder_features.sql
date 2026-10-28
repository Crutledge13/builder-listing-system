-- Feature switches per builder. Every builder runs on the same system; what
-- differs between builders is stored as settings like this one, never as code
-- that checks which builder it is.
--
-- `features_off` lists the optional features a builder does NOT have. Empty
-- (the default) means everything is on, so a feature added later is on for
-- every builder unless our admins turn it off. Only our platform admins change
-- it (it's part of what the builder pays for). Our own staff always see every
-- feature for every builder.
--
-- To add a new switchable feature: add its key to the check below (in a new
-- migration) and to FEATURES in src/lib/features.ts.

alter table public.builder_settings
  add column features_off text[] not null default '{}'
    check (features_off <@ array['comps', 'reverse_prospecting', 'website_check', 'reports', 'builder_tasks']::text[]);

-- Only our admins change a builder's features. Extends the existing guard on
-- who enters the MLS, keeping one guard for admin-only builder settings.
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
  end if;
  return new;
end $$;
revoke all on function public.builder_settings_mls_entry_guard() from public, anon, authenticated;

-- Is a feature on for this builder? Missing settings row = everything on.
create or replace function private.builder_feature_on(b uuid, feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select not (feature = any (features_off)) from public.builder_settings where builder_id = b), true)
$$;
revoke all on function private.builder_feature_on(uuid, text) from public, anon;
grant execute on function private.builder_feature_on(uuid, text) to authenticated;

-- The two features that send work to our team are also refused in the
-- database, so a turned-off builder can't create that work another way.
-- Named to sort after each table's own guard, which fills in builder_id
-- (Postgres runs triggers in name order). Reports, website check and the
-- builder's task board are screens only; hiding them is enough.
create or replace function public.feature_request_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f text := tg_argv[0];
begin
  if not private.builder_feature_on(new.builder_id, f) and not private.is_staff() then
    raise exception 'This builder doesn''t have % turned on. Ask our team.',
      case f when 'comps' then 'comp requests' when 'reverse_prospecting' then 'reverse prospecting' else f end
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.feature_request_guard() from public, anon, authenticated;

create trigger comp_requests_guard_feature before insert on public.comp_requests
  for each row execute function public.feature_request_guard('comps');
create trigger reverse_prospect_guard_feature before insert on public.reverse_prospect_requests
  for each row execute function public.feature_request_guard('reverse_prospecting');
