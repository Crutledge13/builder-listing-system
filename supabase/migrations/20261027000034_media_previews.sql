-- Small preview copies of every upload, so grids never load full-size originals.
--
-- When a photo is uploaded, the browser also makes two smaller WebP copies and
-- puts them in the same private folder as the original:
--   thumb_path: about 640 px on the long side (grids, cards, folder covers)
--   web_path:   about 1600 px on the long side (the photo's own page, AI labeling)
-- For a video, thumb_path is a still frame, so grids show a picture instead of
-- loading the video. The original is untouched and is still what downloads,
-- the MLS photo pack and backups use.
--
-- Older uploads without previews keep working: the file route falls back to
-- the original.

alter table public.media
  add column thumb_path text,
  add column web_path text;

comment on column public.media.thumb_path is 'Private storage path of the small preview (about 640 px WebP; a still frame for videos). Null means use the original.';
comment on column public.media.web_path is 'Private storage path of the screen-size copy (about 1600 px WebP). Null means use the original.';

-- The preview files follow the same rule as the original: you can open them
-- only if you can see the media record.
drop policy "media files: see if you can see the record" on storage.objects;
create policy "media files: see if you can see the record" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and exists (
      select 1 from public.media m
      where m.storage_path = storage.objects.name
         or m.thumb_path = storage.objects.name
         or m.web_path = storage.objects.name
    )
  );

create index media_thumb_path_idx on public.media (thumb_path) where thumb_path is not null;
create index media_web_path_idx on public.media (web_path) where web_path is not null;

-- How many items each community folder holds, counted in the database rather
-- than by sending every media row to the page. Runs as the signed-in person,
-- so row-level security decides what is counted.
create or replace function public.community_media_counts(community_ids uuid[])
returns table (community_id uuid, items bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.community_id, count(*)
  from public.media m
  where m.community_id = any (community_ids) and m.deleted_at is null
  group by m.community_id
$$;

-- Same for the home folders inside a community.
create or replace function public.home_media_counts(home_ids uuid[])
returns table (home_id uuid, items bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.home_id, count(*)
  from public.media m
  where m.home_id = any (home_ids) and m.deleted_at is null
  group by m.home_id
$$;

revoke execute on function public.community_media_counts(uuid[]), public.home_media_counts(uuid[]) from public, anon;
grant execute on function public.community_media_counts(uuid[]), public.home_media_counts(uuid[]) to authenticated;
