-- Media archive (owners, 29 Oct 2026): photos and videos more than 600 days
-- old move to an archive so the library stays tidy and storage can be
-- offloaded over time. Never anything still in use:
--   - a home's files: only once the home is sold or off the market (or deleted);
--   - a community's own files: only once every home in it is sold or off the
--     market (a community still selling keeps its entrance and amenity shots);
--   - the floor plan library (model home photos): never, plans get reused.
-- Archived files are hidden from the media library's normal views, found under
-- its Archive filter, and can be brought back (then they're left alone for
-- 180 days). Nothing is deleted: the database is the record, and the file stays
-- where it is until the storage move (media.storage_class, used when files move
-- to Cloudflare R2's cheaper Infrequent Access storage before launch).
-- The age is app_settings.media_archive_days (600).

alter table public.media
  add column archived_at timestamptz,
  add column archive_hold_until timestamptz,
  add column storage_class text not null default 'standard' check (storage_class in ('standard', 'archive'));
create index media_archived on public.media (builder_id, archived_at) where archived_at is not null;
create index media_archive_candidates on public.media (created_at) where archived_at is null and deleted_at is null;

insert into public.app_settings (key, value) values ('media_archive_days', '600'::jsonb)
on conflict (key) do nothing;

-- Only the people who manage media (and the nightly job) archive or bring back.
-- Bringing a file back keeps the job off it for 180 days.
create or replace function public.media_archive_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only the storage move (trusted code, no signed-in person) changes this.
  if auth.uid() is not null then new.storage_class := old.storage_class; end if;
  if new.archived_at is distinct from old.archived_at or new.archive_hold_until is distinct from old.archive_hold_until then
    if auth.uid() is not null and coalesce(private.my_role() not in ('platform_admin', 'builder_owner', 'manager', 'marketing'), true) then
      raise exception 'Only owners, managers, marketing and our admins archive media' using errcode = '42501';
    end if;
    if new.archived_at is null and old.archived_at is not null and auth.uid() is not null then
      new.archive_hold_until := now() + interval '180 days';
    end if;
    if new.archived_at is not null and old.archived_at is null then
      new.archived_at := now();
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.media_archive_guard() from public, anon, authenticated;
create trigger media_archive_guard before update of archived_at, archive_hold_until, storage_class on public.media
  for each row execute function public.media_archive_guard();

-- The nightly job: archive what's old and no longer in use. Returns how many.
create or replace function private.run_media_archive() returns integer
language plpgsql security definer set search_path = '' as $$
declare days int := coalesce((select (value #>> '{}')::int from public.app_settings where key = 'media_archive_days'), 600);
  n int;
begin
  if days < 30 then days := 600; end if;
  with done_homes as (
    select h.id from public.homes h
    where h.deleted_at is not null or h.market_status in ('sold', 'withdrawn')
  ), done_communities as (
    select c.id from public.communities c
    where exists (select 1 from public.homes h where h.community_id = c.id)
      and not exists (select 1 from public.homes h where h.community_id = c.id
                      and h.deleted_at is null and coalesce(h.market_status, 'active') not in ('sold', 'withdrawn'))
  )
  update public.media m set archived_at = now()
  where m.archived_at is null and m.deleted_at is null
    and m.created_at < now() - make_interval(days => days)
    and (m.archive_hold_until is null or m.archive_hold_until < now())
    and ((m.home_id is not null and m.home_id in (select id from done_homes))
      or (m.home_id is null and m.community_id is not null and m.community_id in (select id from done_communities)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.run_media_archive() from public, anon, authenticated;

select cron.schedule('media-archive', '30 8 * * *', 'select private.run_media_archive()'); -- 3:30 am Central

-- Folder counts on the media library count what's shown (not archived).
create or replace function public.community_media_counts(community_ids uuid[])
returns table(community_id uuid, items bigint) language sql stable set search_path = '' as $$
  select m.community_id, count(*)
  from public.media m
  where m.community_id = any (community_ids) and m.deleted_at is null and m.archived_at is null
  group by m.community_id
$$;
create or replace function public.home_media_counts(home_ids uuid[])
returns table(home_id uuid, items bigint) language sql stable set search_path = '' as $$
  select m.home_id, count(*)
  from public.media m
  where m.home_id = any (home_ids) and m.deleted_at is null and m.archived_at is null
  group by m.home_id
$$;

-- For Admin's storage meter: how much is archived, per builder.
create or replace function public.media_archive_summary()
returns table(builder_id uuid, archived bigint, archived_bytes bigint)
language sql stable security definer set search_path = '' as $$
  select m.builder_id,
    count(*) filter (where m.archived_at is not null),
    coalesce(sum((o.metadata ->> 'size')::bigint) filter (where m.archived_at is not null), 0)
  from public.media m
  left join storage.objects o on o.bucket_id = 'media' and o.name = m.storage_path
  where m.deleted_at is null and private.staff_for(m.builder_id)
  group by m.builder_id
$$;
revoke all on function public.media_archive_summary() from public, anon;
grant execute on function public.media_archive_summary() to authenticated;
