-- Demo media for the TEST project: drawn pictures and short videos generated
-- by the app (see src/lib/demo-media.tsx). No real photos.

-- Every home: exteriors, rooms, floor plan.
insert into public.media (builder_id, home_id, kind, room, title, tags, source, demo_key, mime_type, width, height, is_cover, mls_ready, sort_order)
select h.builder_id, h.id, x.kind, x.room, x.title, x.tags, 'demo', x.demo_key,
       case when x.kind = 'video' then 'video/mp4' else 'image/svg+xml' end, 1440, 960,
       x.sort_order = 0, x.kind <> 'floor_plan', x.sort_order
from public.homes h
cross join (values
  (0, 'photo', 'exterior', 'Front exterior', array['curb appeal'], 'home:exterior:day'),
  (1, 'photo', 'exterior', 'Front exterior at twilight', array['twilight'], 'home:exterior:twilight'),
  (2, 'photo', 'kitchen', 'Kitchen', array['island', 'pendant lights'], 'room:kitchen'),
  (3, 'photo', 'living', 'Family room', array['open concept'], 'room:living'),
  (4, 'photo', 'dining', 'Dining room', array[]::text[], 'room:dining'),
  (5, 'photo', 'primary_bedroom', 'Primary bedroom', array[]::text[], 'room:primary_bedroom'),
  (6, 'photo', 'primary_bath', 'Primary bath', array['double vanity', 'soaking tub'], 'room:primary_bath'),
  (7, 'photo', 'bedroom', 'Secondary bedroom', array[]::text[], 'room:bedroom'),
  (8, 'photo', 'backyard', 'Backyard and covered patio', array['covered patio'], 'room:backyard'),
  (9, 'floor_plan', 'floor_plan', 'Floor plan', array[]::text[], 'floor_plan')
) as x(sort_order, kind, room, title, tags, demo_key)
where not exists (select 1 from public.media m where m.home_id = h.id and m.source = 'demo');

-- Walkthrough video on every third home.
with ranked as (
  select h.id, h.builder_id, row_number() over (order by h.unparsed_address) as n from public.homes h
)
insert into public.media (builder_id, home_id, kind, room, title, tags, source, demo_key, mime_type, width, height, duration_seconds, mls_ready, sort_order)
select r.builder_id, r.id, 'video', null, 'Video walkthrough', array['walkthrough', 'video tour'], 'demo',
       'video:home' || (1 + (r.n / 3) % 3), 'video/mp4', 960, 640, 15, false, 20
from ranked r
where r.n % 3 = 1
  and not exists (select 1 from public.media m where m.home_id = r.id and m.kind = 'video');

-- Every community: entrance, pool, aerial, site plan, model home, tour video.
insert into public.media (builder_id, community_id, kind, room, title, tags, source, demo_key, mime_type, width, height, duration_seconds, mls_ready, sort_order)
select c.builder_id, c.id, x.kind, x.room, c.name || ' ' || x.title, x.tags, 'demo', x.demo_key,
       case when x.kind = 'video' then 'video/mp4' else 'image/svg+xml' end,
       case when x.kind = 'video' then 960 else 1440 end, case when x.kind = 'video' then 640 else 960 end,
       case when x.kind = 'video' then 12.6 end, x.kind = 'photo', x.sort_order
from public.communities c
cross join (values
  (0, 'photo', 'entrance', 'entrance', array['monument sign'], 'community:entrance'),
  (1, 'photo', 'amenity', 'pool', array['pool', 'amenities'], 'community:amenity'),
  (2, 'photo', 'aerial', 'aerial view', array['drone'], 'community:aerial'),
  (3, 'photo', 'site_map', 'site plan', array['lot map'], 'community:site_map'),
  (4, 'photo', 'model_home', 'model home', array['model home'], 'community:model_home'),
  (5, 'video', null, 'community tour', array['video tour', 'drone'], 'video:community')
) as x(sort_order, kind, room, title, tags, demo_key)
where not exists (select 1 from public.media m where m.community_id = c.id and m.home_id is null and m.source = 'demo');
