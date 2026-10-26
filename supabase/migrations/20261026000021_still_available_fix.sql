-- Fix: "Still available" didn't clear the "website shows under contract/sold" alert.
--
-- The answer was saved, but only the weekly "still available?" alert closed.
-- Now "Still available" also closes the website alert, and remembers which
-- website status the builder said was wrong, so the hourly check doesn't raise
-- it again. If the website changes to a different status (say "Pending" to
-- "Sold"), the alert comes back.

alter table public.website_listings
  add column status_confirmed_text text,
  add column status_confirmed_at timestamptz,
  add column status_confirmed_by uuid references public.profiles(id);

create or replace function public.confirm_availability(p_home uuid, p_answer text, p_date date default null, p_price numeric default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare h record; r public.user_role := private.my_role();
begin
  select id, builder_id, community_id, workflow_status into h from public.homes where id = p_home;
  if h.id is null or not (private.is_staff() or (private.can_see_home(h.builder_id, h.community_id)
     and r in ('builder_owner', 'manager', 'sales'))) then
    raise exception 'You can''t update this home' using errcode = '42501';
  end if;
  if h.workflow_status <> 'live_on_mls' then raise exception 'This home isn''t live on the MLS' using errcode = '23514'; end if;
  if p_answer = 'available' then
    perform private.system_update_on();
    update public.homes set availability_confirmed_at = now() where id = p_home;
    perform private.system_update_off();
    update public.website_listings
      set status_confirmed_text = status_text, status_confirmed_at = now(), status_confirmed_by = auth.uid()
      where home_id = p_home and status_text ~* '(sold|under contract|pending|contract)';
    perform private.resolve_alerts(p_home, 'availability_check', 'Still available');
    perform private.resolve_alerts(p_home, 'sold_signal_website', 'Builder confirmed it is still available (website is out of date)');
    return 'available';
  elsif p_answer = 'under_contract' then
    update public.homes set market_status = 'under_contract', purchase_contract_date = coalesce(p_date, current_date) where id = p_home;
    return 'under_contract';
  elsif p_answer = 'sold' then
    if p_price is null then raise exception 'Enter the close price' using errcode = '23514'; end if;
    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price where id = p_home;
    return 'sold';
  end if;
  raise exception 'Unknown answer';
end $$;

-- The hourly check skips a website status the builder already said is wrong.
do $$ declare d text; begin
  d := pg_get_functiondef('private.run_listing_checks'::regproc);
  d := replace(d, $x$and w.status_text ~* '(sold|under contract|pending|contract)' loop$x$,
    $x$and w.status_text ~* '(sold|under contract|pending|contract)'
               and w.status_text is distinct from w.status_confirmed_text loop$x$);
  if position('status_confirmed_text' in d) = 0 then raise exception 'run_listing_checks: pattern not found'; end if;
  execute d;
end $$;
