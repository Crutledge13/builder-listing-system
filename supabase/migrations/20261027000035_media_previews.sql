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

-- Realtor share links get the small copies too: share_file hands back the
-- preview paths, and the signed-out storage check accepts them for the same
-- live links as the original.
drop function public.share_file(text, uuid, boolean);
create function public.share_file(p_token text, p_media uuid, p_download boolean default false)
returns table (storage_path text, title text, source text, demo_key text, mime_type text, kind text, thumb_path text, web_path text)
language plpgsql volatile security definer set search_path = '' as $$
declare s public.share_links;
begin
  s := private.live_share(p_token);
  if s.id is null or p_media not in (select private.shared_media_ids(s.home_id)) then return; end if;
  if p_download then perform private.count_share(s.id, 'download', p_media); end if;
  return query select m.storage_path, m.title, m.source, m.demo_key, m.mime_type, m.kind, m.thumb_path, m.web_path
    from public.media m where m.id = p_media;
end $$;
revoke all on function public.share_file(text, uuid, boolean) from public;
grant execute on function public.share_file(text, uuid, boolean) to anon, authenticated;

create or replace function share_access.file_is_shared(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'media' then exists (
      select 1 from public.media m
      join public.share_links s on s.revoked_at is null and s.expires_at > now()
      where (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name)
        and m.deleted_at is null and m.id in (select private.shared_media_ids(s.home_id)))
    when 'branding' then exists (
      select 1 from public.builder_branding bb
      join public.share_links s on s.builder_id = bb.builder_id and s.revoked_at is null and s.expires_at > now()
      where bb.logo_path = p_name)
    else false end
$$;
