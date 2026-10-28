-- Builders have two logos (owners, 28 Oct 2026): the main logo (usually a wide
-- wordmark, kept its own shape) and an icon (a square mark for small spaces).
-- The icon is optional; anywhere it's wanted falls back to the main logo.
--
-- builder_branding.icon_path / icon_updated_at: same bucket (`branding`) and
-- same folder rule as the logo, same people may change it (the table's
-- existing branding rules). Signed-out realtor share pages may load the icon
-- of a builder with a live share link (share_access.file_is_shared,
-- public.share_icon), and photographers may see it while they have a job.

alter table public.builder_branding
  add column if not exists icon_path text,
  add column if not exists icon_updated_at timestamptz;

create or replace function public.builder_branding_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare c jsonb; clean jsonb := '[]';
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.logo_path is distinct from (case when tg_op = 'UPDATE' then old.logo_path end) then
    new.logo_updated_at := case when new.logo_path is null then null else now() end;
  end if;
  if new.icon_path is distinct from (case when tg_op = 'UPDATE' then old.icon_path end) then
    new.icon_updated_at := case when new.icon_path is null then null else now() end;
  end if;
  if new.brand_guide_path is distinct from (case when tg_op = 'UPDATE' then old.brand_guide_path end) then
    new.brand_guide_uploaded_at := case when new.brand_guide_path is null then null else now() end;
    new.brand_guide_scan := null;
    new.brand_guide_scanned_at := null;
  end if;
  if new.logo_path is not null and split_part(new.logo_path, '/', 1) <> new.builder_id::text then
    raise exception 'The logo must be in this builder''s folder';
  end if;
  if new.icon_path is not null and split_part(new.icon_path, '/', 1) <> new.builder_id::text then
    raise exception 'The icon must be in this builder''s folder';
  end if;
  if new.brand_guide_path is not null and split_part(new.brand_guide_path, '/', 1) <> new.builder_id::text then
    raise exception 'The brand guide must be in this builder''s folder';
  end if;
  for c in select * from jsonb_array_elements(new.colors) loop
    if c ->> 'hex' ~ '^#[0-9a-fA-F]{6}$' and not clean @> jsonb_build_array(jsonb_build_object('hex', lower(c ->> 'hex'))) then
      clean := clean || jsonb_build_array(jsonb_build_object(
        'hex', lower(c ->> 'hex'),
        'name', left(coalesce(nullif(trim(c ->> 'name'), ''), 'Color'), 40)));
    end if;
  end loop;
  new.colors := clean;
  new.primary_color := clean -> 0 ->> 'hex';
  new.secondary_color := clean -> 1 ->> 'hex';
  new.fonts := coalesce((select array_agg(y.t order by y.o) from (select min(z.o) o, min(z.t) t from (select left(trim(x), 60) t, o from unnest(new.fonts) with ordinality u(x, o) where trim(x) <> '') z group by lower(z.t)) y), '{}');
  return new;
end $function$;
revoke execute on function public.builder_branding_touch() from public, anon, authenticated;

-- Photographers see a builder's logo and icon while they have a job for them.
create or replace function private.photographer_sees_logo(path text)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select coalesce(private.my_role() = 'photographer' and exists (
    select 1 from public.builder_branding bb
    join public.media_requests r on r.builder_id = bb.builder_id
    where (bb.logo_path = path or bb.icon_path = path) and r.photographer_id = (select auth.uid())
  ), false)
$function$;

create or replace function public.job_icon_path(p_builder uuid) returns text
language sql stable security definer set search_path = ''
as $function$
  select coalesce(bb.icon_path, bb.logo_path) from public.builder_branding bb
  where bb.builder_id = p_builder and private.photographer_sees_logo(coalesce(bb.icon_path, bb.logo_path))
$function$;
revoke all on function public.job_icon_path(uuid) from public, anon;
grant execute on function public.job_icon_path(uuid) to authenticated;

-- The icon on a realtor share page (falls back to the main logo).
create or replace function public.share_icon(p_token text) returns text
language sql stable security definer set search_path = ''
as $function$
  select coalesce(bb.icon_path, bb.logo_path) from public.builder_branding bb
  where bb.builder_id = (private.live_share(p_token)).builder_id
$function$;
revoke all on function public.share_icon(text) from public;
grant execute on function public.share_icon(text) to anon, authenticated;

create or replace function share_access.file_is_shared(p_bucket text, p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $function$
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
      where bb.logo_path = p_name or bb.icon_path = p_name)
    else false end
$function$;

-- share_page tells the page whether there's an icon (and its version for caching).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.share_page(text)'::regprocedure);
  if position('''icon_updated_at''' in d) = 0 then
    if position('''logo_updated_at'', bb.logo_updated_at,' in d) = 0 then raise exception 'share_page: pattern not found'; end if;
    d := replace(d, '''logo_updated_at'', bb.logo_updated_at,', '''logo_updated_at'', bb.logo_updated_at, ''icon_updated_at'', bb.icon_updated_at,');
    execute d;
  end if;
end $$;
revoke all on function public.share_page(text) from public;
grant execute on function public.share_page(text) to anon, authenticated;
