-- Social media reels never go on the MLS listing (owners, 28 Oct 2026).
--
-- A reel (a video tagged "Vertical reel") is for realtors to post on social
-- media. It's stored with the home's media and shows on the home's realtor
-- share link (share_page already includes every one of the home's own
-- videos), but it stays off `listing_media`, so it never shows on our MLS
-- sheet, work sheets or the builder's "Listing photos, video and tours".
--
--   * Uploading a reel to a home no longer adds it to the listing.
--   * Tagging an existing video as a reel takes it off the listing;
--     untagging a home's own video puts it back on the end.
--   * Nobody can add a reel to a listing by hand.
--   * Reels already on listings come off now.

create or replace function private.is_reel(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce('Vertical reel' = any(p_tags), false)
$$;
revoke all on function private.is_reel(text[]) from public, anon, authenticated;

-- Uploaded to a home: on its listing, unless it's a reel. Trashed: off every
-- listing. Restored to a home, or no longer a reel: back on its listing.
create or replace function public.media_to_listing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reel boolean := private.is_reel(new.tags);
  was_reel boolean := tg_op = 'UPDATE' and private.is_reel(old.tags);
begin
  if new.kind not in ('photo', 'floor_plan', 'video') then return new; end if;
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
    delete from public.listing_media where media_id = new.id;
  elsif reel then
    if tg_op = 'UPDATE' and not was_reel then
      delete from public.listing_media where media_id = new.id;
    end if;
  elsif new.deleted_at is null and new.home_id is not null
        and (tg_op = 'INSERT' or old.deleted_at is not null or was_reel) then
    insert into public.listing_media (home_id, media_id) values (new.home_id, new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.media_to_listing() from public, anon, authenticated;

drop trigger if exists media_to_listing on public.media;
create trigger media_to_listing after insert or update of deleted_at, tags on public.media
  for each row execute function public.media_to_listing();

-- Same checks as before, plus: no reels on a listing.
create or replace function public.listing_media_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h public.homes; ok boolean;
begin
  select * into h from public.homes where id = new.home_id;
  if new.media_id is not null then
    if exists (select 1 from public.media m where m.id = new.media_id and private.is_reel(m.tags)) then
      raise exception 'Social media reels don''t go on the MLS listing. They show on the home''s realtor share link.' using errcode = '23514';
    end if;
    select exists (
      select 1 from public.media m
      where m.id = new.media_id and m.deleted_at is null and m.builder_id = h.builder_id
        and m.kind in ('photo', 'floor_plan', 'video')
        and (m.home_id = h.id
             or (m.home_id is null and m.community_id = h.community_id)
             or (m.home_id is null and m.community_id is null and m.plan_name is not null and m.plan_name = h.plan_name))) into ok;
  else
    select exists (
      select 1 from public.virtual_tours t
      where t.id = new.tour_id and t.deleted_at is null and t.builder_id = h.builder_id
        and (t.home_id = h.id or (t.home_id is null and t.community_id = h.community_id))) into ok;
  end if;
  if not ok then
    raise exception 'That item doesn''t belong to this home, its community or its floor plan' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    new.added_at := now();
    if new.position = 0 then
      select coalesce(max(position), 0) + 1 into new.position from public.listing_media where home_id = new.home_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.listing_media_prepare() from public, anon, authenticated;

-- Reels already on listings come off.
delete from public.listing_media lm
using public.media m
where m.id = lm.media_id and private.is_reel(m.tags);
