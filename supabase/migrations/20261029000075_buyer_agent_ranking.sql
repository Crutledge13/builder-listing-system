-- Buyer's agent ranking for our team (owners, 29 Oct 2026): which buyers'
-- agents sell the most of our builders' homes in each market, so we know who
-- to court. Built from what each sale already records on the home (RESO
-- BuyerAgentFullName / BuyerAgentMlsId / BuyerOfficeName and the co-buyer
-- agent, asked when a home goes under contract or sells), counting only sold
-- homes. An agent is the same person across homes by their MLS ID, or by name
-- and brokerage when there's no ID. Our staff only, and a listing coordinator
-- only across the builders they work on (private.staff_for).
create or replace function public.buyer_agent_ranking(
  p_from date default null, p_to date default null, p_board text default null, p_county text default null, p_city text default null)
returns table (
  agent_key text, agent_name text, agent_mls_id text, office_name text,
  homes_sold integer, volume numeric, co_agent_on integer, builders integer,
  homes jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.is_staff(), false) then
    raise exception 'Our team only' using errcode = '42501';
  end if;
  return query
  with sales as (
    -- The buyer's agent, and the co-buyer agent as a second row.
    select h.id, h.builder_id, h.unparsed_address, h.city, h.close_date, h.close_price, h.mls_board, c.county, c.name as community,
           h.buyer_agent_full_name as name, h.buyer_agent_mls_id as mls_id, h.buyer_office_name as office, false as co
    from public.homes h join public.communities c on c.id = h.community_id
    where h.market_status = 'sold' and h.deleted_at is null and not h.buyer_unrepresented
      and nullif(btrim(h.buyer_agent_full_name), '') is not null and private.staff_for(h.builder_id)
    union all
    select h.id, h.builder_id, h.unparsed_address, h.city, h.close_date, h.close_price, h.mls_board, c.county, c.name,
           h.co_buyer_agent_full_name, null, h.co_buyer_office_name, true
    from public.homes h join public.communities c on c.id = h.community_id
    where h.market_status = 'sold' and h.deleted_at is null
      and nullif(btrim(h.co_buyer_agent_full_name), '') is not null and private.staff_for(h.builder_id)
  ), named as (
    select s.*, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')) || '|' || lower(regexp_replace(coalesce(btrim(s.office), ''), '\s+', ' ', 'g')) as nk
    from sales s
  ), ids as (
    -- Someone listed without an MLS ID (often as the co-agent) is the same
    -- agent as a sale with the same name and brokerage that has one.
    select distinct on (n.nk) n.nk, upper(btrim(n.mls_id)) as mls_id
    from named n where nullif(btrim(n.mls_id), '') is not null
    order by n.nk, n.close_date desc nulls last
  ), picked as (
    select s.*, coalesce('mls:' || upper(nullif(btrim(s.mls_id), '')), 'mls:' || i.mls_id, 'name:' || s.nk) as k
    from named s left join ids i on i.nk = s.nk
    where (p_from is null or s.close_date >= p_from)
      and (p_to is null or s.close_date <= p_to)
      and (p_board is null or s.mls_board = p_board)
      and (p_county is null or s.county = p_county)
      and (p_city is null or lower(s.city) = lower(p_city))
  )
  select p.k,
    (array_agg(regexp_replace(btrim(p.name), '\s+', ' ', 'g') order by p.co, p.close_date desc nulls last))[1],
    (array_agg(nullif(btrim(p.mls_id), '') order by p.close_date desc nulls last) filter (where nullif(btrim(p.mls_id), '') is not null))[1],
    (array_agg(nullif(btrim(p.office), '') order by p.co, p.close_date desc nulls last) filter (where nullif(btrim(p.office), '') is not null))[1],
    count(distinct p.id)::int,
    coalesce(sum(p.close_price), 0),
    count(*) filter (where p.co)::int,
    count(distinct p.builder_id)::int,
    jsonb_agg(jsonb_build_object('home_id', p.id, 'address', p.unparsed_address, 'city', p.city, 'community', p.community,
      'county', p.county, 'board', p.mls_board, 'close_date', p.close_date, 'close_price', p.close_price, 'co', p.co,
      'builder', (select replace(b.name, ' (demo)', '') from public.builders b where b.id = p.builder_id))
      order by p.close_date desc nulls last)
  from picked p
  group by p.k
  order by count(distinct p.id) desc, coalesce(sum(p.close_price), 0) desc, 2;
end $$;
revoke all on function public.buyer_agent_ranking(date, date, text, text, text) from public, anon;
grant execute on function public.buyer_agent_ranking(date, date, text, text, text) to authenticated;

-- Pages filter homes by sale and close date.
create index homes_sold_close on public.homes (close_date) where market_status = 'sold' and deleted_at is null;
