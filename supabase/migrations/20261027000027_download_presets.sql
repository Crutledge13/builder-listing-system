-- Download sizes. Everyone can download a photo at full quality, MLS size,
-- website size and so on; builders add their own sizes (e.g. "Our website:
-- 1600 px WebP") and pick which one is their default. The resizing happens in
-- the browser, so files never pass through our server.

create table public.download_presets (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid references public.builders(id) on delete cascade, -- null = built-in, for everyone
  name text not null check (length(trim(name)) between 1 and 40),
  long_edge int check (long_edge between 200 and 8000),               -- null = keep the original size
  format text not null default 'jpeg' check (format in ('original', 'jpeg', 'webp', 'png')),
  quality int not null default 85 check (quality between 40 and 100),
  is_default boolean not null default false,
  sort int not null default 100,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index download_presets_builder on public.download_presets (builder_id);
-- One default per builder (and one built-in default).
create unique index download_presets_one_default on public.download_presets (coalesce(builder_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_default;

alter table public.download_presets enable row level security;
create policy "see built-in and your builder's sizes" on public.download_presets
  for select to authenticated using (
    private.my_role() is not null and (builder_id is null or private.can_see_builder(builder_id))
  );
create policy "builder sizes: owners, managers, marketing add" on public.download_presets
  for insert to authenticated with check (
    (builder_id is not null and private.can_edit_branding(builder_id)) or (builder_id is null and private.my_role() = 'platform_admin')
  );
create policy "builder sizes: owners, managers, marketing change" on public.download_presets
  for update to authenticated using (
    (builder_id is not null and private.can_edit_branding(builder_id)) or (builder_id is null and private.my_role() = 'platform_admin')
  ) with check (
    (builder_id is not null and private.can_edit_branding(builder_id)) or (builder_id is null and private.my_role() = 'platform_admin')
  );
create policy "builder sizes: owners, managers, marketing remove" on public.download_presets
  for delete to authenticated using (
    (builder_id is not null and private.can_edit_branding(builder_id)) or (builder_id is null and private.my_role() = 'platform_admin')
  );

-- Making one size the default clears the old default for that builder.
create or replace function public.download_presets_one_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_default then
    update public.download_presets set is_default = false
    where id <> new.id and is_default and builder_id is not distinct from new.builder_id;
  end if;
  return new;
end $$;
create trigger download_presets_one_default before insert or update of is_default on public.download_presets
  for each row execute function public.download_presets_one_default();

insert into public.download_presets (builder_id, name, long_edge, format, quality, is_default, sort) values
  (null, 'Full quality (original file)', null, 'original', 100, true, 10),
  (null, 'MLS (2048 px JPG)', 2048, 'jpeg', 85, false, 20),
  (null, 'Website (1920 px WebP)', 1920, 'webp', 82, false, 30),
  (null, 'Social media (1080 px JPG)', 1080, 'jpeg', 85, false, 40),
  (null, 'Email (1024 px JPG)', 1024, 'jpeg', 80, false, 50);

-- Each builder's default size: a built-in one or one of its own.
alter table public.builder_branding add column default_download_preset uuid references public.download_presets(id) on delete set null;
create or replace function public.builder_branding_check_preset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.default_download_preset is not null and not exists (
    select 1 from public.download_presets p where p.id = new.default_download_preset and (p.builder_id is null or p.builder_id = new.builder_id)
  ) then
    raise exception 'That download size belongs to another builder';
  end if;
  return new;
end $$;
create trigger builder_branding_check_preset before insert or update of default_download_preset on public.builder_branding
  for each row execute function public.builder_branding_check_preset();
