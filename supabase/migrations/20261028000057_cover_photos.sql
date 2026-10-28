-- Real photos on cards (owners, 28 Oct 2026). Home cards, community cards and
-- headers show a real photo once there is one, instead of the drawn picture.
--
-- A home's card photo: the photo the builder chose as the cover (media.is_cover),
-- otherwise the first photo on its MLS listing, otherwise its first photo.
-- A community's: its own chosen cover (a community photo with is_cover), then
-- its other community photos (entrance first), then its homes' card photos.
--
-- Both run with the caller's own access (security invoker), so people only
-- get photos they can already see.

create or replace function public.home_cover_photos(p_homes uuid[])
returns table (home_id uuid, media_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct on (m.home_id) m.home_id, m.id
  from public.media m
  left join public.listing_media lm on lm.media_id = m.id and lm.home_id = m.home_id
  where m.home_id = any (p_homes) and m.kind = 'photo' and m.deleted_at is null
  order by m.home_id, m.is_cover desc, lm.position nulls last, m.sort_order, m.created_at
$$;
revoke all on function public.home_cover_photos(uuid[]) from public, anon;
grant execute on function public.home_cover_photos(uuid[]) to authenticated;

create or replace function public.community_cover_photos(p_communities uuid[])
returns table (community_id uuid, media_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct on (x.community_id) x.community_id, x.id
  from (
    select m.community_id, m.id, 0 as tier, m.is_cover, m.room = 'entrance' as entrance, null::integer as pos, m.sort_order, m.created_at
    from public.media m
    where m.community_id = any (p_communities) and m.home_id is null and m.plan_name is null
      and m.kind = 'photo' and m.deleted_at is null
    union all
    select h.community_id, m.id, 1, m.is_cover, false, lm.position, m.sort_order, m.created_at
    from public.homes h
    join public.media m on m.home_id = h.id and m.kind = 'photo' and m.deleted_at is null
    left join public.listing_media lm on lm.media_id = m.id and lm.home_id = h.id
    where h.community_id = any (p_communities) and h.deleted_at is null
  ) x
  order by x.community_id, x.tier, x.is_cover desc, x.entrance desc, x.pos nulls last, x.sort_order, x.created_at
$$;
revoke all on function public.community_cover_photos(uuid[]) from public, anon;
grant execute on function public.community_cover_photos(uuid[]) to authenticated;
