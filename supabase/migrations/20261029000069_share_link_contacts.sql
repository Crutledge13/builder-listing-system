-- Realtor links show who to call (owners, 29 Oct 2026).
--
-- Each person now has their own standing link for each home (share_links.owner_id),
-- so the page can show the right contact:
--   - a salesperson's link (in person or online) shows that salesperson;
--   - anyone else's (marketing, managers, the owner, our team) shows every
--     salesperson on the home's community (the ones on site first; online sales
--     counselors only when there's nobody on site);
--   - with no salesperson on the community, the builder's main point of contact.
-- Worked out when the page opens, so it follows people being moved, turned off
-- or added. A builder can switch the contact off in Realtor page settings.
-- Links made before this belong to whoever first opened the home, and keep
-- working.

alter table public.share_links add column owner_id uuid references public.profiles(id);
update public.share_links set owner_id = created_by where expires_at is null;

drop index public.share_links_one_standing;
create unique index share_links_one_standing on public.share_links (home_id, owner_id)
  where expires_at is null and revoked_at is null and deleted_at is null;
create index share_links_owner on public.share_links (owner_id) where owner_id is not null;

-- Nobody can make or move a link onto someone else's name.
create or replace function public.share_links_owner_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := case when new.expires_at is null then coalesce(auth.uid(), new.owner_id) else null end;
  else
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
revoke execute on function public.share_links_owner_guard() from public, anon, authenticated;
create trigger share_links_owner_guard before insert or update on public.share_links
  for each row execute function public.share_links_owner_guard();

-- The caller's own standing link for the home, made the first time they ask.
create or replace function public.home_share_link(p_home uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare h record; t text; me uuid := auth.uid();
begin
  if me is null then return null; end if;
  select id, builder_id, community_id, deleted_at into h from public.homes where id = p_home;
  if h.id is null or h.deleted_at is not null then return null; end if;
  if not coalesce(private.staff_for(h.builder_id)
          or private.can_share(h.builder_id)
          or (private.my_role() = 'sales' and private.can_see_home(h.builder_id, h.community_id)), false) then
    return null;
  end if;
  select token into t from public.share_links
    where home_id = p_home and owner_id = me and expires_at is null and revoked_at is null and deleted_at is null;
  if t is null then
    insert into public.share_links (home_id, builder_id, expires_at, created_by, owner_id)
      values (p_home, h.builder_id, null, me, me)
      on conflict do nothing;
    select token into t from public.share_links
      where home_id = p_home and owner_id = me and expires_at is null and revoked_at is null and deleted_at is null;
  end if;
  return t;
end $$;
revoke all on function public.home_share_link(uuid) from public, anon;
grant execute on function public.home_share_link(uuid) to authenticated;

-- A switch for it in Realtor page settings (on unless turned off).
alter table public.share_page_settings add column show_contact boolean not null default true;

create or replace function private.share_settings(p_builder uuid) returns public.share_page_settings
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s from public.share_page_settings s where s.builder_id = p_builder),
    row(p_builder, true, true, true, true, true, true, true, true, true, now(), null, true)::public.share_page_settings)
$$;
revoke all on function private.share_settings(uuid) from public, anon, authenticated;

-- Who to call, for the share page: name, job title, phone and email only.
create or replace function public.share_contacts(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.share_links; h record; o record; out jsonb;
begin
  select * into s from private.live_share(p_token);
  if s.id is null then return '[]'::jsonb; end if;
  if not (private.share_settings(s.builder_id)).show_contact then return '[]'::jsonb; end if;
  select id, community_id into h from public.homes where id = s.home_id;

  -- A salesperson's own link: them, while they're still on this community.
  select p.id, p.full_name, p.job_title, p.phone, p.email, p.online_sales into o
  from public.profiles p
  where p.id = coalesce(s.owner_id, s.created_by) and p.is_active and p.role = 'sales' and p.builder_id = s.builder_id
    and exists (select 1 from public.community_assignments a where a.profile_id = p.id and a.community_id = h.community_id);
  if o.id is not null then
    return jsonb_build_array(jsonb_build_object('name', o.full_name,
      'title', coalesce(nullif(btrim(o.job_title), ''), case when o.online_sales then 'Online sales counselor' else 'Sales' end),
      'phone', o.phone, 'email', o.email));
  end if;

  -- Anyone else's link: the community's salespeople, on site first.
  with team as (
    select p.full_name, p.job_title, p.phone, p.email, p.online_sales
    from public.profiles p
    join public.community_assignments a on a.profile_id = p.id and a.community_id = h.community_id
    where p.is_active and p.role = 'sales' and p.builder_id = s.builder_id
  ), pick as (
    select * from team where not online_sales
    union all
    select * from team where online_sales and not exists (select 1 from team t where not t.online_sales)
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', full_name,
      'title', coalesce(nullif(btrim(job_title), ''), case when online_sales then 'Online sales counselor' else 'Sales' end),
      'phone', phone, 'email', email) order by full_name), '[]'::jsonb)
    into out from (select * from pick limit 6) x;
  if jsonb_array_length(out) > 0 then return out; end if;

  -- Nobody on the community: the builder's main point of contact, if set.
  select coalesce(jsonb_agg(jsonb_build_object('name', bs.main_contact_name, 'title', nullif(btrim(bs.main_contact_title), ''),
      'phone', bs.main_contact_phone, 'email', bs.main_contact_email)), '[]'::jsonb)
    into out from public.builder_settings bs
    where bs.builder_id = s.builder_id and nullif(btrim(bs.main_contact_name), '') is not null;
  return out;
end $$;
revoke all on function public.share_contacts(text) from public;
grant execute on function public.share_contacts(text) to anon, authenticated;
