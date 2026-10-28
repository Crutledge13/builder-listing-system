-- Company details the builder fills in themselves (owners' decision, 28 Oct 2026).
--
-- Onboarding asks our team only for what we need before the invite. The
-- builder adds the rest on their Company details page (/company) and setup
-- checklist: their main point of contact (defaults to the owner, which is who
-- we deal with), billing contact, website and default title company. Listing
-- feed questions are left for a later step, not onboarding.
--
-- 1. builder_settings.main_contact_*: who we call at the builder. Same rules
--    as builder_settings: owners, managers, marketing and our admins change it;
--    everyone at the builder and our staff read it.
-- 2. Billing contact stays in builder_onboarding (staff-read), but the
--    builder's owner can now set it through public.set_billing_contact, and
--    builder_setup_state tells the checklist whether it's done (and shows the
--    details to the owner and our staff only; managers have no billing access).

alter table public.builder_settings
  add column main_contact_name text check (length(main_contact_name) <= 80),
  add column main_contact_title text check (length(main_contact_title) <= 80),
  add column main_contact_email text check (length(main_contact_email) <= 200),
  add column main_contact_phone text check (length(main_contact_phone) <= 30);

-- Who can see or change billing details: the builder's owner, and our platform admins.
create or replace function private.can_manage_billing(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (private.my_role() = 'platform_admin')
    or (b = private.my_builder_id() and private.my_role() = 'builder_owner'), false)
$$;
revoke execute on function private.can_manage_billing(uuid) from public, anon;

create or replace function public.set_billing_contact(p_builder uuid, p_name text, p_email text, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n text := nullif(btrim(p_name), '');
  e text := lower(nullif(btrim(p_email), ''));
  ph text := nullif(btrim(p_phone), '');
begin
  if not private.can_manage_billing(p_builder) then
    raise exception 'Only the company owner can change the billing contact' using errcode = '42501';
  end if;
  if e is not null and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That billing email doesn''t look right' using errcode = '22023';
  end if;
  insert into public.builder_onboarding (builder_id) values (p_builder) on conflict do nothing;
  update public.builder_onboarding
     set billing_contact_name = left(n, 80), billing_contact_email = left(e, 200), billing_contact_phone = left(ph, 30)
   where builder_id = p_builder;
end $$;
revoke execute on function public.set_billing_contact(uuid, text, text, text) from public, anon;
grant execute on function public.set_billing_contact(uuid, text, text, text) to authenticated;

create or replace function public.builder_setup_state(p_builder uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.builder_onboarding; billing boolean := private.can_manage_billing(p_builder) or private.staff_for(p_builder);
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'You can only see your own company''s setup' using errcode = '42501';
  end if;
  select * into r from public.builder_onboarding where builder_id = p_builder;
  return jsonb_build_object(
    'skipped', to_jsonb(coalesce(r.skipped, '{}')),
    'finished_at', r.finished_at,
    'agreement_signed', r.agreement_signed_on is not null,
    'billing_set', r.billing_contact_name is not null and r.billing_contact_email is not null,
    'billing', case when billing then jsonb_build_object(
      'name', r.billing_contact_name, 'email', r.billing_contact_email, 'phone', r.billing_contact_phone) end,
    'can_edit_billing', private.can_manage_billing(p_builder)
  );
end $$;
revoke execute on function public.builder_setup_state(uuid) from public, anon;
grant execute on function public.builder_setup_state(uuid) to authenticated;
