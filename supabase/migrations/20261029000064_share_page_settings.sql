-- Realtor share page settings and the community section (owners, 29 Oct 2026).
--
-- 1. share_page_settings: one row per builder of on/off switches for what the
--    realtor share page shows. No row = everything on (the defaults), so every
--    builder keeps today's page until marketing changes something. Owners,
--    managers, marketing and our admins change them (private.can_edit_branding);
--    everyone at the builder and our staff for that builder can read them.
-- 2. The share page gets a community section: the community's own photos and
--    video (not tied to one home) and the community's tour links, so a realtor
--    can market the whole community and funnel buyers down to this home.
-- 3. What the page shows and which files a link hands out both follow the
--    switches (private.shared_media_ids), so a switched-off item can't be
--    fetched by its id either.

create table public.share_page_settings (
  builder_id uuid primary key references public.builders(id) on delete cascade,
  show_community boolean not null default true,   -- community photos, video and tours
  show_photos boolean not null default true,      -- the home's listing photos
  show_walkthrough boolean not null default true, -- horizontal walkthrough video
  show_reels boolean not null default true,       -- vertical social media reels
  show_tours boolean not null default true,       -- 3D and video tour links
  show_incentives boolean not null default true,
  show_open_houses boolean not null default true,
  show_post_ideas boolean not null default true,  -- written social post ideas (page only)
  show_website boolean not null default true,     -- "More info on {builder}'s website" (page only)
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.share_page_settings enable row level security;
revoke all on public.share_page_settings from anon;

create policy "see your builder's share page settings" on public.share_page_settings for select to authenticated
  using (coalesce(private.staff_for(builder_id) or builder_id = (select private.my_builder_id()), false));
create policy "branding editors add share page settings" on public.share_page_settings for insert to authenticated
  with check (private.can_edit_branding(builder_id));
create policy "branding editors change share page settings" on public.share_page_settings for update to authenticated
  using (private.can_edit_branding(builder_id)) with check (private.can_edit_branding(builder_id));

-- Who and when, set by the database; changes go in the builder's activity log.
create or replace function public.share_page_settings_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end $$;
revoke execute on function public.share_page_settings_touch() from public, anon, authenticated;
create trigger share_page_settings_touch before insert or update on public.share_page_settings
  for each row execute function public.share_page_settings_touch();

-- A builder's settings, or the defaults when they haven't saved any.
create or replace function private.share_settings(p_builder uuid) returns public.share_page_settings
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s from public.share_page_settings s where s.builder_id = p_builder),
    row(p_builder, true, true, true, true, true, true, true, true, true, now(), null)::public.share_page_settings)
$$;
revoke all on function private.share_settings(uuid) from public, anon, authenticated;

-- Every file a home's share link may hand out, following the switches.
create or replace function private.shared_media_ids(p_home uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare h public.homes; st public.share_page_settings;
begin
  select * into h from public.homes where id = p_home;
  if h.id is null then return; end if;
  st := private.share_settings(h.builder_id);
  return query
    -- On the listing: photos and floor plans, and any video added to it.
    select lm.media_id from public.listing_media lm join public.media m on m.id = lm.media_id
      where lm.home_id = p_home and m.deleted_at is null
        and case when m.kind = 'video' then st.show_walkthrough else st.show_photos end
    union
    -- The home's own videos: walkthroughs and reels, each with its switch.
    select m.id from public.media m
      where m.home_id = p_home and m.deleted_at is null and m.kind = 'video'
        and case when private.is_reel(m.tags) then st.show_reels else st.show_walkthrough end
    union
    -- Homes without a listing order yet: their own photos.
    select m.id from public.media m
      where st.show_photos and m.home_id = p_home and m.deleted_at is null and m.kind in ('photo', 'floor_plan')
        and not exists (select 1 from public.listing_media lm where lm.home_id = p_home and lm.media_id is not null)
    union
    -- The community section: the community's own photos and video.
    select m.id from public.media m
      where st.show_community and m.community_id = h.community_id and m.home_id is null
        and m.builder_id = h.builder_id and m.deleted_at is null and m.kind in ('photo', 'video');
end $$;
revoke all on function private.shared_media_ids(uuid) from public, anon, authenticated;

-- Everything the share page shows. Null for a wrong, expired or turned-off link.
-- Same as before (20261028000060, plus the icon from 062), and now:
--   * 'settings': the builder's switches, so the page can hide sections;
--   * each media item says whether it's for the community section;
--   * 'community_tours': the community's tour links (when the community is on);
--   * tours, incentives and open houses are empty when switched off.
create or replace function public.share_page(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare s public.share_links; st public.share_page_settings; result jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  s := private.live_share(p_token);
  if s.id is null then return null; end if;
  st := private.share_settings(s.builder_id);
  select jsonb_build_object(
    'link', jsonb_build_object('recipient_name', s.recipient_name, 'message', s.message, 'expires_at', s.expires_at),
    'settings', jsonb_build_object(
      'community', st.show_community, 'photos', st.show_photos, 'walkthrough', st.show_walkthrough, 'reels', st.show_reels,
      'tours', st.show_tours, 'incentives', st.show_incentives, 'open_houses', st.show_open_houses,
      'post_ideas', st.show_post_ideas, 'website', st.show_website),
    'home', jsonb_build_object(
      'id', h.id, 'address', h.unparsed_address, 'city', h.city, 'postal_code', h.postal_code, 'plan_name', h.plan_name,
      'list_price', h.list_price, 'bedrooms_total', h.bedrooms_total, 'bathrooms_full', h.bathrooms_full, 'bathrooms_half', h.bathrooms_half,
      'living_area', h.living_area, 'stories', h.stories, 'build_stage', h.build_stage, 'estimated_completion', h.estimated_completion,
      'public_remarks', h.public_remarks, 'disclaimer', h.show_representative_disclaimer, 'market_status', h.market_status),
    'community', jsonb_build_object('name', c.name, 'city', c.city),
    'builder', jsonb_build_object(
      'id', b.id, 'name', b.name, 'logo_updated_at', bb.logo_updated_at, 'icon_updated_at', bb.icon_updated_at, 'primary_color', bb.primary_color,
      'secondary_color', bb.secondary_color, 'colors', coalesce(bb.colors, '[]'::jsonb), 'fonts', coalesce(to_jsonb(bb.fonts), '[]'::jsonb),
      'tagline', bb.tagline, 'website_url', bb.website_url),
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'kind', m.kind, 'room', m.room, 'source', m.source, 'demo_key', m.demo_key, 'mime_type', m.mime_type,
        'caption', m.caption, 'tags', m.tags, 'duration_seconds', m.duration_seconds, 'plan_name', m.plan_name,
        'home_id', m.home_id, 'community_id', m.community_id, 'builder_id', m.builder_id,
        'vertical', private.is_reel(m.tags),
        -- Community items already on this home's listing stay with the home's photos.
        'for_community', (m.home_id is null and m.community_id = h.community_id and lm.id is null)
      ) order by coalesce(lm.position, 100000), m.kind, m.sort_order, m.created_at)
      from public.media m
      left join public.listing_media lm on lm.media_id = m.id and lm.home_id = h.id
      where m.id in (select private.shared_media_ids(h.id))
    ), '[]'),
    'incentives', case when st.show_incentives then coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'details', i.details, 'ends_on', i.ends_on, 'scope', i.scope)
        order by case i.scope when 'home' then 0 when 'community' then 1 else 2 end, i.ends_on)
      from public.incentives i
      where i.status = 'active' and i.ends_on >= private.today_central() and i.builder_id = h.builder_id
        and (i.scope = 'builder' or (i.scope = 'community' and i.community_id = h.community_id) or (i.scope = 'home' and i.home_id = h.id))
    ), '[]') else '[]' end,
    'open_houses', case when st.show_open_houses then coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', o.starts_at, 'ends_at', o.ends_at) order by o.starts_at)
      from (
        select o.starts_at, o.ends_at from public.open_houses o
        where o.home_id = h.id and o.cancelled_at is null and o.ends_at > now()
        order by o.starts_at limit 4
      ) o
    ), '[]') else '[]' end,
    'tours', case when st.show_tours then coalesce((
      select jsonb_agg(jsonb_build_object('url', t.url, 'provider', t.provider, 'title', t.title, 'branded', t.branded) order by lm.position)
      from public.listing_media lm join public.virtual_tours t on t.id = lm.tour_id
      where lm.home_id = h.id and t.deleted_at is null
    ), '[]') else '[]' end,
    'community_tours', case when st.show_community then coalesce((
      select jsonb_agg(jsonb_build_object('url', t.url, 'provider', t.provider, 'title', t.title, 'branded', t.branded) order by t.created_at)
      from public.virtual_tours t
      where t.community_id = h.community_id and t.home_id is null and t.builder_id = h.builder_id and t.deleted_at is null
        and not exists (select 1 from public.listing_media lm where lm.home_id = h.id and lm.tour_id = t.id)
    ), '[]') else '[]' end
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
