-- Setup checklist: communities and floor plans can be skipped for later
-- (owners' request, 28 Oct 2026). Skipping "communities" covers the whole
-- communities section (add communities, set each one up, put salespeople on
-- them); "plans" covers floor plans. "Put it back" brings either back.

alter table public.builder_onboarding drop constraint if exists builder_onboarding_skipped_check;
alter table public.builder_onboarding
  add constraint builder_onboarding_skipped_check
  check (skipped <@ array['team', 'brand_guide', 'website', 'title_company', 'communities', 'plans']::text[]);

create or replace function public.set_setup_skip(p_builder uuid, p_step text, p_skip boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'Only the owner, a manager or marketing can change the setup checklist' using errcode = '42501';
  end if;
  if p_step not in ('team', 'brand_guide', 'website', 'title_company', 'communities', 'plans') then
    raise exception 'That step can''t be skipped' using errcode = '22023';
  end if;
  insert into public.builder_onboarding (builder_id) values (p_builder) on conflict do nothing;
  update public.builder_onboarding
     set skipped = case when p_skip then array(select distinct unnest(skipped || p_step))
                        else array_remove(skipped, p_step) end
   where builder_id = p_builder;
end $$;
revoke execute on function public.set_setup_skip(uuid, text, boolean) from public, anon;
grant execute on function public.set_setup_skip(uuid, text, boolean) to authenticated;
