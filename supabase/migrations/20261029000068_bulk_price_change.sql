-- Bulk price change (owners, 29 Oct 2026): a builder picks homes in a
-- community and raises or lowers them all at once (e.g. every home $5,000 off).
-- Runs as the person asking (security invoker), one home at a time through the
-- normal update, so the usual rules all apply to each home: who may change a
-- price (enforce_home_edit_rules: not sales), the price history, the activity
-- log and the MLS update task for live listings. All or nothing: if any home
-- can't change, none do.
create or replace function public.bulk_change_prices(p_homes uuid[], p_mode text, p_amount numeric)
returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer := 0; h record; next_price numeric;
begin
  if coalesce(private.my_role() not in ('platform_admin', 'builder_owner', 'manager', 'marketing'), true) then
    raise exception 'Only owners, managers, marketing and our admins can change prices' using errcode = '42501';
  end if;
  if p_mode not in ('lower', 'raise', 'lower_pct', 'raise_pct') then raise exception 'Unknown change'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter how much to change the prices by' using errcode = '23514'; end if;
  if p_mode like '%_pct' and p_amount >= 50 then raise exception 'A percentage change must be under 50%%' using errcode = '23514'; end if;
  if cardinality(coalesce(p_homes, '{}')) = 0 then raise exception 'Pick at least one home' using errcode = '23514'; end if;
  if cardinality(p_homes) > 500 then raise exception 'Change at most 500 homes at a time' using errcode = '23514'; end if;
  if (select count(distinct community_id) from public.homes where id = any (p_homes)) > 1 then
    raise exception 'Pick homes from one community at a time' using errcode = '23514';
  end if;

  for h in select id, list_price, unparsed_address from public.homes
           where id = any (p_homes) and deleted_at is null order by unparsed_address for update loop
    if h.list_price is null then
      raise exception '% has no price yet, so it can''t be raised or lowered. Untick it.', h.unparsed_address using errcode = '23514';
    end if;
    next_price := case p_mode
      when 'lower' then h.list_price - p_amount
      when 'raise' then h.list_price + p_amount
      when 'lower_pct' then round(h.list_price * (1 - p_amount / 100))
      when 'raise_pct' then round(h.list_price * (1 + p_amount / 100)) end;
    if next_price < 1000 then
      raise exception 'That would put % at %. Check the amount.', h.unparsed_address, to_char(next_price, 'FM$999,999,990') using errcode = '23514';
    end if;
    update public.homes set list_price = next_price where id = h.id;
    if not found then raise exception 'You can''t change %', h.unparsed_address using errcode = '42501'; end if;
    n := n + 1;
  end loop;
  -- Homes the caller can't see were never in the loop: refuse rather than half-do it.
  if n <> cardinality(array(select distinct unnest(p_homes))) then
    raise exception 'Some of those homes aren''t yours to change' using errcode = '42501';
  end if;
  return n;
end $$;
revoke execute on function public.bulk_change_prices(uuid[], text, numeric) from public, anon;
grant execute on function public.bulk_change_prices(uuid[], text, numeric) to authenticated;
