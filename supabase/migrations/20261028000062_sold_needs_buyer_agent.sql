-- The MLS needs the buyer's agent on a closed sale too, not only when a home
-- goes under contract. A home marked sold straight from active (or from the
-- "Needs your attention" panel) now asks for it the same way, and our team's
-- "Change to Sold" task lists it like the pending one does.

-- 1. The rule: under contract or sold needs the buyer's agent and brokerage,
--    or "the buyer has no agent". (A sale that went through under contract
--    already has them, so nothing new is asked.)
do $$ declare d text; begin
  d := pg_get_functiondef('public.enforce_home_edit_rules'::regproc);
  d := replace(d, $x$  if new.market_status = 'under_contract' and old.market_status is distinct from 'under_contract'$x$,
    $x$  if new.market_status in ('under_contract', 'sold') and old.market_status is distinct from new.market_status$x$);
  if position($x$new.market_status in ('under_contract', 'sold') and old.market_status is distinct from new.market_status$x$ in d) = 0 then
    raise exception 'enforce_home_edit_rules: pattern not found';
  end if;
  execute d;
end $$;

-- 2. "Sold" from Needs your attention takes the buyer's agent too.
do $$ declare d text; begin
  d := pg_get_functiondef('public.confirm_availability'::regproc);
  d := replace(d, $x$    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price where id = p_home;$x$,
    $x$    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price,
      buyer_unrepresented = case when p_buyer is null then buyer_unrepresented else coalesce((p_buyer ->> 'unrepresented')::boolean, false) end,
      buyer_agent_full_name = case when p_buyer is null then buyer_agent_full_name else nullif(btrim(p_buyer ->> 'agent_name'), '') end,
      buyer_office_name = case when p_buyer is null then buyer_office_name else nullif(btrim(p_buyer ->> 'office_name'), '') end,
      buyer_agent_mls_id = case when p_buyer is null then buyer_agent_mls_id else nullif(btrim(p_buyer ->> 'agent_mls_id'), '') end,
      buyer_agent_state_license = case when p_buyer is null then buyer_agent_state_license else nullif(btrim(p_buyer ->> 'agent_license'), '') end,
      co_buyer_agent_full_name = case when p_buyer is null then co_buyer_agent_full_name else nullif(btrim(p_buyer ->> 'co_agent_name'), '') end,
      co_buyer_office_name = case when p_buyer is null then co_buyer_office_name else nullif(btrim(p_buyer ->> 'co_office_name'), '') end
    where id = p_home;$x$);
  if position('buyer_unrepresented = case when p_buyer is null' in d) = 0 then raise exception 'confirm_availability: pattern not found'; end if;
  execute d;
end $$;

-- 3. Our team's "Change to Sold" task lists the buyer's agent, like "Change to Pending".
do $$ declare d text; begin
  d := pg_get_functiondef('public.homes_tasks'::regproc);
  d := replace(d, $x$    if new.market_status = 'under_contract' then
      status_changes := status_changes || jsonb_build_object('purchase_contract_date',
        jsonb_build_object('label', 'Contract date', 'from', null, 'to', new.purchase_contract_date));
      if new.buyer_unrepresented then$x$, $x$    if new.market_status in ('under_contract', 'sold') then
      if new.market_status = 'under_contract' then
        status_changes := status_changes || jsonb_build_object('purchase_contract_date',
          jsonb_build_object('label', 'Contract date', 'from', null, 'to', new.purchase_contract_date));
      else
        status_changes := status_changes
          || jsonb_build_object('close_date', jsonb_build_object('label', 'Close date', 'from', null, 'to', new.close_date))
          || jsonb_build_object('close_price', jsonb_build_object('label', 'Close price', 'from', null, 'to', new.close_price));
      end if;
      if new.buyer_unrepresented then$x$);
  d := replace(d, $x$    elsif new.market_status = 'sold' then
      status_changes := status_changes
        || jsonb_build_object('close_date', jsonb_build_object('label', 'Close date', 'from', null, 'to', new.close_date))
        || jsonb_build_object('close_price', jsonb_build_object('label', 'Close price', 'from', null, 'to', new.close_price));
    end if;$x$, $x$    end if;$x$);
  if position($x$if new.market_status in ('under_contract', 'sold') then$x$ in d) = 0 or position($x$elsif new.market_status = 'sold' then$x$ in d) > 0 then
    raise exception 'homes_tasks: pattern not found';
  end if;
  execute d;
end $$;
