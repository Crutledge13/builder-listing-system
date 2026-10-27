-- Photo requests can ask for a vertical social media reel (9:16) as well as
-- the horizontal walkthrough video.
alter table public.media_requests drop constraint media_requests_needs_check;
alter table public.media_requests add constraint media_requests_needs_check
  check (needs <@ array['photos', 'twilight', 'video', 'vertical_video', 'drone', 'floor_plan', 'virtual_tour']);

update public.photographer_rates set label = 'Walkthrough video (horizontal)' where need = 'video';
insert into public.photographer_rates (need, label, amount_cents) values ('vertical_video', 'Vertical social reel (9:16)', 15000)
  on conflict (need) do nothing;

-- A shared tag so reels are easy to find in the media library.
insert into public.media_tags (label, category, aliases, sort) values
  ('Vertical reel', 'shot', '{reel,vertical video,social reel,instagram reel,tiktok,9:16}', 35)
  on conflict do nothing;
