-- Realtor share links: the one exception to "never public-facing".
--
-- A builder (owner, manager, marketing) or our admin makes a link for one
-- home. Anyone with the link sees a page with that home's listing photos,
-- walkthrough video, vertical reel and tour links, and can download them for
-- their own marketing. The link:
--   * is a long random code, unlisted and hidden from search engines;
--   * expires (30 days by default) and can be turned off at any time;
--   * shows only that one home (nothing else about the builder);
--   * logs every view and download.
-- Signed-out visitors never read tables directly. They only get what the
-- functions below hand out for a valid link, and files still come through
-- short-lived storage links.

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_'),
  home_id uuid not null references public.homes(id) on delete cascade,
  builder_id uuid not null references public.builders(id) on delete cascade,
  recipient_name text check (length(recipient_name) <= 120),
  recipient_email text check (length(recipient_email) <= 200),
  message text check (length(message) <= 1000),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  view_count int not null default 0,
  download_count int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint share_links_expiry check (expires_at <= created_at + interval '366 days')
);
create index share_links_home on public.share_links (home_id);

create table public.share_link_events (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.share_links(id) on delete cascade,
  kind text not null check (kind in ('view', 'download')),
  media_id uuid references public.media(id) on delete set null,
  detail text check (length(detail) <= 200),
  at timestamptz not null default now()
);
create index share_link_events_link on public.share_link_events (link_id, at desc);

-- Who manages a builder's share links: its owners, managers, marketing; our admins.
create or replace function private.can_share(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id())
$$;
revoke all on function private.can_share(uuid) from public, anon;
grant execute on function private.can_share(uuid) to authenticated;

alter table public.share_links enable row level security;
create policy "see share links: builder leads, marketing, our staff" on public.share_links
  for select to authenticated using (private.can_share(builder_id) or private.is_staff());
create policy "make share links" on public.share_links
  for insert to authenticated with check (private.can_share(builder_id) and created_by = auth.uid());
create policy "change share links" on public.share_links
  for update to authenticated using (private.can_share(builder_id)) with check (private.can_share(builder_id));

alter table public.share_link_events enable row level security;
create policy "see share link activity" on public.share_link_events
  for select to authenticated using (exists (
    select 1 from public.share_links s where s.id = link_id and (private.can_share(s.builder_id) or private.is_staff())
  ));
-- Events are only written by the functions below.

-- Fill the builder from the home; keep the token and counts out of people's hands.
create or replace function public.share_links_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  if tg_op = 'INSERT' then
    select id, builder_id, deleted_at into h from public.homes where id = new.home_id;
    if h.id is null or h.deleted_at is not null then raise exception 'Unknown home'; end if;
    new.builder_id := h.builder_id;
    new.token := replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
    new.view_count := 0;
    new.download_count := 0;
    new.last_viewed_at := null;
    new.revoked_at := null;
    new.created_at := now();
    if new.expires_at <= now() then raise exception 'Pick an expiry date in the future'; end if;
    perform private.log_activity(new.home_id, 'share_link_created',
      jsonb_build_object('for', coalesce(new.recipient_name, new.recipient_email, 'a realtor'), 'expires', new.expires_at));
  else
    -- Only the expiry and turning it off can change.
    new.token := old.token;
    new.home_id := old.home_id;
    new.builder_id := old.builder_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if coalesce(current_setting('app.share_counting', true), '') <> 'on' then
      new.view_count := old.view_count;
      new.download_count := old.download_count;
      new.last_viewed_at := old.last_viewed_at;
    end if;
    if new.revoked_at is not null and old.revoked_at is null then
      new.revoked_by := auth.uid();
      perform private.log_activity(new.home_id, 'share_link_turned_off', jsonb_build_object('for', coalesce(new.recipient_name, new.recipient_email, 'a realtor')));
    elsif new.revoked_at is null and old.revoked_at is not null then
      new.revoked_by := null;
    end if;
    if new.expires_at > old.created_at + interval '366 days' then raise exception 'Links can last up to a year'; end if;
  end if;
  return new;
end $$;
create trigger share_links_prepare before insert or update on public.share_links
  for each row execute function public.share_links_prepare();

-- A link that works right now.
create or replace function private.live_share(p_token text) returns public.share_links
language sql stable security definer set search_path = '' as $$
  select s.* from public.share_links s join public.homes h on h.id = s.home_id
  where s.token = p_token and s.revoked_at is null and s.expires_at > now() and h.deleted_at is null
$$;
revoke all on function private.live_share(text) from public, anon, authenticated;

-- The home's items a link may hand out: what's on its listing (photos, floor
-- plans, video), plus the home's own videos (walkthrough and vertical reel).
create or replace function private.shared_media_ids(p_home uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select lm.media_id from public.listing_media lm join public.media m on m.id = lm.media_id
    where lm.home_id = p_home and m.deleted_at is null
  union
  select m.id from public.media m where m.home_id = p_home and m.deleted_at is null and m.kind = 'video'
  union
  -- Homes without a listing order yet: their own photos.
  select m.id from public.media m
    where m.home_id = p_home and m.deleted_at is null and m.kind in ('photo', 'floor_plan')
      and not exists (select 1 from public.listing_media lm where lm.home_id = p_home and lm.media_id is not null)
$$;
revoke all on function private.shared_media_ids(uuid) from public, anon, authenticated;

create or replace function private.count_share(p_link uuid, p_kind text, p_media uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.share_link_events (link_id, kind, media_id) values (p_link, p_kind, p_media);
  perform set_config('app.share_counting', 'on', true);
  update public.share_links set
    view_count = view_count + (p_kind = 'view')::int,
    download_count = download_count + (p_kind = 'download')::int,
    last_viewed_at = case when p_kind = 'view' then now() else last_viewed_at end
  where id = p_link;
  perform set_config('app.share_counting', 'off', true);
end $$;
revoke all on function private.count_share(uuid, text, uuid) from public, anon, authenticated;

-- Everything the share page shows. Null for a wrong, expired or turned-off link.
create or replace function public.share_page(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
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
    'builder', jsonb_build_object('id', b.id, 'name', b.name, 'logo_updated_at', bb.logo_updated_at, 'primary_color', bb.primary_color, 'website_url', bb.website_url),
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
end $$;

-- One file for a valid link (and log the download when asked).
create or replace function public.share_file(p_token text, p_media uuid, p_download boolean default false)
returns table (storage_path text, title text, source text, demo_key text, mime_type text)
language plpgsql volatile security definer set search_path = '' as $$
declare s public.share_links;
begin
  s := private.live_share(p_token);
  if s.id is null or p_media not in (select private.shared_media_ids(s.home_id)) then return; end if;
  if p_download then perform private.count_share(s.id, 'download', p_media); end if;
  return query select m.storage_path, m.title, m.source, m.demo_key, m.mime_type from public.media m where m.id = p_media;
end $$;

-- The builder's logo for a valid link.
create or replace function public.share_logo(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select bb.logo_path from public.builder_branding bb
  where bb.builder_id = (private.live_share(p_token)).builder_id
$$;

revoke all on function public.share_page(text), public.share_file(text, uuid, boolean), public.share_logo(text) from public;
grant execute on function public.share_page(text), public.share_file(text, uuid, boolean), public.share_logo(text) to anon, authenticated;

-- Storage: a signed-out visitor may get a short-lived link only to files of a
-- home that has a live share link (and only through the share page, which
-- checks the code first). File names are random, so they can't be guessed.
-- In its own small schema: signed-out visitors may use this one check, nothing else.
create schema if not exists share_access;
revoke all on schema share_access from public;
grant usage on schema share_access to anon, authenticated;

create or replace function share_access.file_is_shared(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'media' then exists (
      select 1 from public.media m
      join public.share_links s on s.revoked_at is null and s.expires_at > now()
      where m.storage_path = p_name and m.deleted_at is null and m.id in (select private.shared_media_ids(s.home_id)))
    when 'branding' then exists (
      select 1 from public.builder_branding bb
      join public.share_links s on s.builder_id = bb.builder_id and s.revoked_at is null and s.expires_at > now()
      where bb.logo_path = p_name)
    else false end
$$;
revoke all on function share_access.file_is_shared(text, text) from public;
grant execute on function share_access.file_is_shared(text, text) to anon, authenticated;

create policy "shared files: live realtor share links" on storage.objects
  for select to anon using (bucket_id in ('media', 'branding') and share_access.file_is_shared(bucket_id, objects.name));

-- Someone signed in to a different company can open a share link too.
drop policy "shared files: live realtor share links" on storage.objects;
create policy "shared files: live realtor share links" on storage.objects
  for select to anon, authenticated using (bucket_id in ('media', 'branding') and share_access.file_is_shared(bucket_id, objects.name));
