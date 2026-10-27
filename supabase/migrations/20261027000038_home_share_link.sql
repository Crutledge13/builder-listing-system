-- One standing share link per home (owners, 27 Oct 2026).
--
-- Instead of typing in a realtor's details to make a link, every home has one
-- link that's always there to copy and send to anyone. It has no end date
-- (expires_at is null) and works until someone replaces it (deletes it; a new
-- one is made the next time the home is opened). Older links with a realtor's
-- name and an end date keep working as before until they expire or are deleted.
--
-- The page also gets a button to the builder's website: the home's own page on
-- it when we know it (website_listings.url), otherwise the builder's main site.

alter table public.share_links drop constraint share_links_expiry;
alter table public.share_links alter column expires_at drop not null;
alter table public.share_links add constraint share_links_expiry
  check (expires_at is null or expires_at <= created_at + interval '366 days');

-- At most one standing link per home.
create unique index share_links_one_standing on public.share_links (home_id)
  where expires_at is null and revoked_at is null and deleted_at is null;

-- A link that works right now (no end date, or not past it).
create or replace function private.live_share(p_token text) returns public.share_links
language sql stable security definer set search_path = '' as $$
  select s.* from public.share_links s join public.homes h on h.id = s.home_id
  where s.token = p_token and s.revoked_at is null and s.deleted_at is null
    and (s.expires_at is null or s.expires_at > now()) and h.deleted_at is null
$$;
revoke all on function private.live_share(text) from public, anon, authenticated;

create or replace function share_access.file_is_shared(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'media' then exists (
      select 1 from public.media m
      join public.share_links s on s.revoked_at is null and s.deleted_at is null and (s.expires_at is null or s.expires_at > now())
      where (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name)
        and m.deleted_at is null and m.id in (select private.shared_media_ids(s.home_id)))
    when 'branding' then exists (
      select 1 from public.builder_branding bb
      join public.share_links s on s.builder_id = bb.builder_id and s.revoked_at is null and s.deleted_at is null
        and (s.expires_at is null or s.expires_at > now())
      where bb.logo_path = p_name)
    else false end
$$;
revoke all on function share_access.file_is_shared(text, text) from public;
grant execute on function share_access.file_is_shared(text, text) to anon, authenticated;

-- The home's standing link code, made the first time anyone asks. Anyone who
-- can see the home can copy it: owners, managers, marketing, salespeople for
-- their assigned communities, and our staff. Only owners, managers, marketing
-- and our admins can replace it (that's an update, covered by the table's RLS).
create or replace function public.home_share_link(p_home uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare h record; t text;
begin
  select id, builder_id, community_id, deleted_at into h from public.homes where id = p_home;
  if h.id is null or h.deleted_at is not null then return null; end if;
  if not (private.is_staff()
          or private.can_share(h.builder_id)
          or (private.my_role() = 'sales' and private.can_see_home(h.builder_id, h.community_id))) then
    return null;
  end if;
  select token into t from public.share_links
    where home_id = p_home and expires_at is null and revoked_at is null and deleted_at is null;
  if t is null then
    insert into public.share_links (home_id, builder_id, expires_at, created_by)
      values (p_home, h.builder_id, null, auth.uid())
      on conflict do nothing;
    select token into t from public.share_links
      where home_id = p_home and expires_at is null and revoked_at is null and deleted_at is null;
  end if;
  return t;
end $$;
revoke all on function public.home_share_link(uuid) from public, anon;
grant execute on function public.home_share_link(uuid) to authenticated;

-- Where "More on the builder's website" goes for a valid link.
create or replace function public.share_website(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w.url from public.website_listings w
      where w.home_id = s.home_id and w.url ~* '^https?://' order by w.last_seen_at desc limit 1),
    (select bb.website_url from public.builder_branding bb where bb.builder_id = s.builder_id and bb.website_url ~* '^https?://'))
  from private.live_share(p_token) s
  where s.id is not null
$$;
revoke all on function public.share_website(text) from public;
grant execute on function public.share_website(text) to anon, authenticated;
