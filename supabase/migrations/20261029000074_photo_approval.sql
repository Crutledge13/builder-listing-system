-- Photographer deliveries wait for approval (owners, 29 Oct 2026). Files our
-- photographers upload start as "waiting for approval" (media.review_status =
-- 'pending'): they're in the media library with a badge, but they don't go on
-- the home's MLS listing, the realtor share page or a home's card until the
-- builder's marketing team (or the owner, a manager or our admins) approves
-- them. Approving puts the home's photos on its listing (and, for a live
-- listing, on the MLS update task); "Don't use" keeps them off. When a shoot is
-- delivered, marketing gets an inbox notice and an email (the owner and
-- managers when the builder has no marketing people). Everyone else's uploads
-- work as before (review_status stays null = approved).

alter table public.media
  add column review_status text check (review_status in ('pending', 'approved', 'not_used')),
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;
create index media_pending_review on public.media (builder_id, home_id, community_id) where review_status = 'pending' and deleted_at is null;

-- Who reviews: the people who manage media at the builder, and our admins.
create or replace function private.can_review_media(p_builder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and p_builder = private.my_builder_id()), false)
$$;
revoke execute on function private.can_review_media(uuid) from public, anon;
grant execute on function private.can_review_media(uuid) to authenticated;

create or replace function public.media_review_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.review_status := case when private.my_role() = 'photographer' then 'pending' end;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;
  -- A photographer swapping the file behind one of their photos sends it back
  -- for approval (and off the listing), so nothing unapproved slips onto the MLS.
  if private.my_role() = 'photographer'
     and (new.storage_path is distinct from old.storage_path or new.thumb_path is distinct from old.thumb_path
          or new.web_path is distinct from old.web_path) then
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;
  if new.review_status is distinct from old.review_status then
    if auth.uid() is not null and not private.can_review_media(new.builder_id) then
      raise exception 'Marketing, managers and the owner approve the photographer''s photos' using errcode = '42501';
    end if;
    if new.review_status is null or new.review_status = 'pending' then
      raise exception 'Approve it or mark it not used' using errcode = '23514';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
revoke execute on function public.media_review_guard() from public, anon, authenticated;
create trigger media_review_guard before insert or update on public.media
  for each row execute function public.media_review_guard();

-- The MLS listing: only approved files go on it, and approving adds them.
create or replace function public.media_to_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  reel boolean := private.is_reel(new.tags);
  was_reel boolean := tg_op = 'UPDATE' and private.is_reel(old.tags);
  ok boolean := coalesce(new.review_status, 'approved') = 'approved';
  was_ok boolean := tg_op = 'UPDATE' and coalesce(old.review_status, 'approved') = 'approved';
begin
  if new.kind not in ('photo', 'floor_plan', 'video') then return new; end if;
  if (new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null))
     or (not ok and tg_op = 'UPDATE' and was_ok) then
    delete from public.listing_media where media_id = new.id;
  elsif reel then
    if tg_op = 'UPDATE' and not was_reel then
      delete from public.listing_media where media_id = new.id;
    end if;
  elsif ok and new.deleted_at is null and new.home_id is not null
        and (tg_op = 'INSERT' or old.deleted_at is not null or was_reel or not was_ok) then
    insert into public.listing_media (home_id, media_id) values (new.home_id, new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.media_to_listing() from public, anon, authenticated;

create or replace function public.listing_media_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h public.homes; ok boolean;
begin
  select * into h from public.homes where id = new.home_id;
  if new.media_id is not null then
    if exists (select 1 from public.media m where m.id = new.media_id and private.is_reel(m.tags)) then
      raise exception 'Social media reels don''t go on the MLS listing. They show on the home''s realtor share link.' using errcode = '23514';
    end if;
    if exists (select 1 from public.media m where m.id = new.media_id and coalesce(m.review_status, 'approved') <> 'approved') then
      raise exception 'Approve the photographer''s photo before it goes on the listing' using errcode = '23514';
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

-- The realtor page shows approved files only.
create or replace function private.shared_media_ids(p_home uuid) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare h public.homes; st public.share_page_settings;
begin
  select * into h from public.homes where id = p_home;
  if h.id is null then return; end if;
  st := private.share_settings(h.builder_id);
  return query
    select lm.media_id from public.listing_media lm join public.media m on m.id = lm.media_id
      where lm.home_id = p_home and m.deleted_at is null and coalesce(m.review_status, 'approved') = 'approved'
        and case when m.kind = 'video' then st.show_walkthrough else st.show_photos end
    union
    select m.id from public.media m
      where m.home_id = p_home and m.deleted_at is null and m.kind = 'video' and coalesce(m.review_status, 'approved') = 'approved'
        and case when private.is_reel(m.tags) then st.show_reels else st.show_walkthrough end
    union
    select m.id from public.media m
      where st.show_photos and m.home_id = p_home and m.deleted_at is null and m.kind in ('photo', 'floor_plan')
        and coalesce(m.review_status, 'approved') = 'approved'
        and not exists (select 1 from public.listing_media lm where lm.home_id = p_home and lm.media_id is not null)
    union
    select m.id from public.media m
      where st.show_community and m.community_id = h.community_id and m.home_id is null
        and m.builder_id = h.builder_id and m.deleted_at is null and m.kind in ('photo', 'video')
        and coalesce(m.review_status, 'approved') = 'approved';
end $$;
revoke all on function private.shared_media_ids(uuid) from public, anon, authenticated;

-- Cards lead with an approved photo.
create or replace function public.home_cover_photos(p_homes uuid[])
returns table(home_id uuid, media_id uuid) language sql stable set search_path = '' as $$
  select distinct on (m.home_id) m.home_id, m.id
  from public.media m
  left join public.listing_media lm on lm.media_id = m.id and lm.home_id = m.home_id
  where m.home_id = any (p_homes) and m.kind = 'photo' and m.deleted_at is null
    and coalesce(m.review_status, 'approved') = 'approved'
  order by m.home_id, m.is_cover desc, lm.position nulls last, m.sort_order, m.created_at
$$;

-- Community banners and cards too.
create or replace function public.community_cover_photos(p_communities uuid[])
returns table(community_id uuid, media_id uuid) language sql stable set search_path = '' as $$
  select distinct on (x.community_id) x.community_id, x.id
  from (
    select m.community_id, m.id, 0 as tier, m.is_cover, m.room = 'entrance' as entrance, null::integer as pos, m.sort_order, m.created_at
    from public.media m
    where m.community_id = any (p_communities) and m.home_id is null and m.plan_name is null
      and m.kind = 'photo' and m.deleted_at is null and coalesce(m.review_status, 'approved') = 'approved'
    union all
    select h.community_id, m.id, 1, m.is_cover, false, lm.position, m.sort_order, m.created_at
    from public.homes h
    join public.media m on m.home_id = h.id and m.kind = 'photo' and m.deleted_at is null
      and coalesce(m.review_status, 'approved') = 'approved'
    left join public.listing_media lm on lm.media_id = m.id and lm.home_id = h.id
    where h.community_id = any (p_communities) and h.deleted_at is null
  ) x
  order by x.community_id, x.tier, x.is_cover desc, x.entrance desc, x.pos nulls last, x.sort_order, x.created_at
$$;

-- Approve or set aside photographer files (as the person deciding).
create or replace function public.review_media(p_ids uuid[], p_decision text) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_decision not in ('approved', 'not_used') then raise exception 'Unknown decision'; end if;
  update public.media set review_status = p_decision
    where id = any (coalesce(p_ids, '{}')) and review_status is distinct from p_decision and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.review_media(uuid[], text) from public, anon;
grant execute on function public.review_media(uuid[], text) to authenticated;

-- A delivered shoot tells marketing there are photos to approve.
create or replace function public.media_requests_review_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare roles text[]; pending int; href text; p record;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    roles := case when exists (select 1 from public.profiles where builder_id = new.builder_id and role = 'marketing' and is_active)
                  then array['marketing'] else array['builder_owner', 'manager'] end;
    select count(*) into pending from public.media m
      where m.review_status = 'pending' and m.deleted_at is null and m.builder_id = new.builder_id
        and (m.home_id = new.home_id or (new.home_id is null and m.community_id = new.community_id and m.home_id is null));
    href := case when new.home_id is not null then '/homes/' || new.home_id || '#photo-approval' else '/media?community=' || new.community_id end;
    for p in select id from public.profiles where builder_id = new.builder_id and is_active and role::text = any (roles) loop
      perform private.notify(p.id, 'photo_review', left('Photos to approve: ' || new.address, 200),
        coalesce(new.photographer_name, 'Our photographer') || ' delivered ' || pending || ' '
          || case when pending = 1 then 'file' else 'files' end || '. Approve them to put them on the listing for the MLS.'
          || coalesce(E'\n\nFrom the photographer: ' || new.photographer_note, ''),
        href);
      perform private.queue_email_to(p.id, left('Photos to approve: ' || new.address, 200),
        coalesce(new.photographer_name, 'Our photographer') || ' delivered ' || pending || ' '
          || case when pending = 1 then 'file' else 'files' end || ' for ' || new.address || '.'
          || E'\n\nOpen the home in Builder Listings to approve them. Approved photos go on the listing for the MLS.',
        'media_requests', new.id);
    end loop;
  end if;
  return new;
end $$;
revoke execute on function public.media_requests_review_notice() from public, anon, authenticated;
create trigger media_requests_review_notice after update of status on public.media_requests
  for each row execute function public.media_requests_review_notice();

-- media_to_listing also runs when a file is approved or set aside.
create or replace trigger media_to_listing after insert or update of deleted_at, tags, review_status, storage_path, thumb_path, web_path on public.media
  for each row execute function public.media_to_listing();
