-- Realtor share page as a builder-branded marketing piece (owners, 28 Oct 2026).
-- share_page now also returns the builder's second color, named colors, fonts
-- and tagline (from builder_branding), and the home's upcoming open houses
-- (start and end only), so the page can look like the builder's own material
-- and give realtors a reason to show the home. Nothing else is added: the
-- page still shows only this one home.
--
-- Same rules as before: security definer, the token is checked through
-- private.live_share, every view is counted.

create or replace function public.share_page(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare s public.share_links; result jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  s := private.live_share(p_token);
  if s.id is null then return null; end if;
  select jsonb_build_object(
    'link', jsonb_build_object('recipient_name', s.recipient_name, 'message', s.message, 'expires_at', s.expires_at),
    'home', jsonb_build_object(
      'id', h.id, 'address', h.unparsed_address, 'city', h.city, 'postal_code', h.postal_code, 'plan_name', h.plan_name,
      'list_price', h.list_price, 'bedrooms_total', h.bedrooms_total, 'bathrooms_full', h.bathrooms_full, 'bathrooms_half', h.bathrooms_half,
      'living_area', h.living_area, 'stories', h.stories, 'build_stage', h.build_stage, 'estimated_completion', h.estimated_completion,
      'public_remarks', h.public_remarks, 'disclaimer', h.show_representative_disclaimer, 'market_status', h.market_status),
    'community', jsonb_build_object('name', c.name, 'city', c.city),
    'builder', jsonb_build_object(
      'id', b.id, 'name', b.name, 'logo_updated_at', bb.logo_updated_at, 'primary_color', bb.primary_color,
      'secondary_color', bb.secondary_color, 'colors', coalesce(bb.colors, '[]'::jsonb), 'fonts', coalesce(to_jsonb(bb.fonts), '[]'::jsonb),
      'tagline', bb.tagline, 'website_url', bb.website_url),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'kind', m.kind, 'room', m.room, 'source', m.source, 'demo_key', m.demo_key, 'mime_type', m.mime_type,
        'caption', m.caption, 'tags', m.tags, 'duration_seconds', m.duration_seconds, 'plan_name', m.plan_name,
        'home_id', m.home_id, 'community_id', m.community_id, 'builder_id', m.builder_id,
        'vertical', 'Vertical reel' = any(m.tags)
      ) order by coalesce(lm.position, 100000), m.kind, m.sort_order, m.created_at)
      from public.media m
      left join public.listing_media lm on lm.media_id = m.id and lm.home_id = h.id
      where m.id in (select private.shared_media_ids(h.id))
    ), '[]'),
    'incentives', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'details', i.details, 'ends_on', i.ends_on, 'scope', i.scope)
        order by case i.scope when 'home' then 0 when 'community' then 1 else 2 end, i.ends_on)
      from public.incentives i
      where i.status = 'active' and i.ends_on >= private.today_central() and i.builder_id = h.builder_id
        and (i.scope = 'builder' or (i.scope = 'community' and i.community_id = h.community_id) or (i.scope = 'home' and i.home_id = h.id))
    ), '[]'),
    'open_houses', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', o.starts_at, 'ends_at', o.ends_at) order by o.starts_at)
      from (
        select o.starts_at, o.ends_at from public.open_houses o
        where o.home_id = h.id and o.cancelled_at is null and o.ends_at > now()
        order by o.starts_at limit 4
      ) o
    ), '[]'),
    'tours', coalesce((
      select jsonb_agg(jsonb_build_object('url', t.url, 'provider', t.provider, 'title', t.title, 'branded', t.branded) order by lm.position)
      from public.listing_media lm join public.virtual_tours t on t.id = lm.tour_id
      where lm.home_id = h.id and t.deleted_at is null
    ), '[]')
  ) into result
  from public.homes h
  join public.communities c on c.id = h.community_id
  join public.builders b on b.id = h.builder_id
  left join public.builder_branding bb on bb.builder_id = h.builder_id
  where h.id = s.home_id;
  perform private.count_share(s.id, 'view', null);
  return result;
end $function$;

revoke all on function public.share_page(text) from public;
grant execute on function public.share_page(text) to anon, authenticated;
