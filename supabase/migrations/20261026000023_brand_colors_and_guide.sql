-- Builders can have any number of brand colors (each with a name), a list of
-- fonts, and an uploaded brand guide (PDF or image). The guide can be read by
-- AI; what it finds is kept as a suggestion until someone adds it.

alter table public.builder_branding
  add column colors jsonb not null default '[]' check (jsonb_typeof(colors) = 'array' and jsonb_array_length(colors) <= 16),
  add column fonts text[] not null default '{}',
  add column brand_guide_path text,
  add column brand_guide_name text check (length(brand_guide_name) <= 200),
  add column brand_guide_uploaded_at timestamptz,
  add column brand_guide_scan jsonb,
  add column brand_guide_scanned_at timestamptz;

-- Bring over the two colors from before.
update public.builder_branding set colors = (
  select coalesce(jsonb_agg(x), '[]') from (
    select jsonb_build_object('name', 'Main', 'hex', primary_color) x where primary_color is not null
    union all select jsonb_build_object('name', 'Second', 'hex', secondary_color) where secondary_color is not null
  ) s
);

create or replace function public.builder_branding_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c jsonb; clean jsonb := '[]';
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.logo_path is distinct from (case when tg_op = 'UPDATE' then old.logo_path end) then
    new.logo_updated_at := case when new.logo_path is null then null else now() end;
  end if;
  if new.brand_guide_path is distinct from (case when tg_op = 'UPDATE' then old.brand_guide_path end) then
    new.brand_guide_uploaded_at := case when new.brand_guide_path is null then null else now() end;
    new.brand_guide_scan := null;
    new.brand_guide_scanned_at := null;
  end if;
  if new.logo_path is not null and split_part(new.logo_path, '/', 1) <> new.builder_id::text then
    raise exception 'The logo must be in this builder''s folder';
  end if;
  if new.brand_guide_path is not null and split_part(new.brand_guide_path, '/', 1) <> new.builder_id::text then
    raise exception 'The brand guide must be in this builder''s folder';
  end if;

  -- Colors: keep only well-formed entries, lowercase hex, no repeats.
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
  -- Fonts: trimmed, no repeats, in the order given (the first is the main font).
  new.fonts := coalesce((select array_agg(y.t order by y.o) from (select min(z.o) o, min(z.t) t from (select left(trim(x), 60) t, o from unnest(new.fonts) with ordinality u(x, o) where trim(x) <> '') z group by lower(z.t)) y), '{}');
  return new;
end $$;

-- Brand guides can be PDFs and bigger than a logo.
update storage.buckets
  set file_size_limit = 26214400,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
  where id = 'branding';
