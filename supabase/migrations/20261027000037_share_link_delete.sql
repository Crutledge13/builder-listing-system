-- Share links can be deleted (owners asked for Delete instead of Turn off).
--
-- Like everything else, a delete goes to the trash first: deleted_at is set,
-- the link stops working at once and drops off the home's list, and it can be
-- put back (Undo) with whatever state it had. Nothing is hard-deleted.

alter table public.share_links
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id);

-- Same rules as before, plus: people can't touch a deleted link except to
-- restore it, and deleting/restoring is logged on the home.
create or replace function public.share_links_prepare() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record; who text;
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
    new.deleted_at := null;
    new.deleted_by := null;
    new.created_at := now();
    if new.expires_at <= now() then raise exception 'Pick an expiry date in the future'; end if;
    perform private.log_activity(new.home_id, 'share_link_created',
      jsonb_build_object('for', coalesce(new.recipient_name, new.recipient_email, 'a realtor'), 'expires', new.expires_at));
  else
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
    who := coalesce(new.recipient_name, new.recipient_email, 'a realtor');

    if old.deleted_at is not null then
      -- In the trash: the only change allowed is putting it back as it was.
      if new.deleted_at is not null then raise exception 'That link was deleted'; end if;
      new.expires_at := old.expires_at;
      new.revoked_at := old.revoked_at;
      new.revoked_by := old.revoked_by;
      new.deleted_by := null;
      perform private.log_activity(new.home_id, 'share_link_restored', jsonb_build_object('for', who));
      return new;
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by := auth.uid();
      new.expires_at := old.expires_at;
      new.revoked_at := old.revoked_at;
      perform private.log_activity(new.home_id, 'share_link_deleted', jsonb_build_object('for', who));
      return new;
    end if;

    if new.revoked_at is not null and old.revoked_at is null then
      new.revoked_by := auth.uid();
      perform private.log_activity(new.home_id, 'share_link_turned_off', jsonb_build_object('for', who));
    elsif new.revoked_at is null and old.revoked_at is not null then
      new.revoked_by := null;
    end if;
    if new.expires_at > old.created_at + interval '366 days' then raise exception 'Links can last up to a year'; end if;
  end if;
  return new;
end $$;

-- A deleted link works nowhere: not the page, not files, not the logo.
create or replace function private.live_share(p_token text) returns public.share_links
language sql stable security definer set search_path = '' as $$
  select s.* from public.share_links s join public.homes h on h.id = s.home_id
  where s.token = p_token and s.revoked_at is null and s.deleted_at is null and s.expires_at > now() and h.deleted_at is null
$$;
revoke all on function private.live_share(text) from public, anon, authenticated;

create or replace function share_access.file_is_shared(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'media' then exists (
      select 1 from public.media m
      join public.share_links s on s.revoked_at is null and s.deleted_at is null and s.expires_at > now()
      where (m.storage_path = p_name or m.thumb_path = p_name or m.web_path = p_name)
        and m.deleted_at is null and m.id in (select private.shared_media_ids(s.home_id)))
    when 'branding' then exists (
      select 1 from public.builder_branding bb
      join public.share_links s on s.builder_id = bb.builder_id and s.revoked_at is null and s.deleted_at is null and s.expires_at > now()
      where bb.logo_path = p_name)
    else false end
$$;
revoke all on function share_access.file_is_shared(text, text) from public;
grant execute on function share_access.file_is_shared(text, text) to anon, authenticated;
