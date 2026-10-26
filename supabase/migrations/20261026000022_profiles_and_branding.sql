-- People edit their own profile (name, phone, title, headshot), and builder
-- owners, managers and marketing manage their company's branding (logo,
-- colors, website). Both images live in private storage buckets and are shown
-- through short-lived links, like all other media.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column phone text check (length(phone) <= 30),
  add column job_title text check (length(job_title) <= 80),
  add column avatar_path text,
  add column avatar_updated_at timestamptz;

-- The only way to edit your own profile. It can't touch role, company or
-- access, which stay with owners, managers and our admins.
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_job_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.my_role() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then raise exception 'Enter your name' using errcode = '23514'; end if;
  update public.profiles set
    full_name = left(trim(p_full_name), 80),
    phone = nullif(left(trim(coalesce(p_phone, '')), 30), ''),
    job_title = nullif(left(trim(coalesce(p_job_title, '')), 80), '')
  where id = auth.uid();
end $$;

-- Set or clear your headshot. The file must be in your own folder.
create or replace function public.set_my_avatar(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.my_role() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'That file isn''t yours' using errcode = '42501';
  end if;
  update public.profiles set avatar_path = p_path, avatar_updated_at = case when p_path is null then null else now() end
  where id = auth.uid();
end $$;

revoke all on function public.update_my_profile(text, text, text), public.set_my_avatar(text) from public, anon;
grant execute on function public.update_my_profile(text, text, text), public.set_my_avatar(text) to authenticated;

-- When someone confirms a new sign-in email, copy it to their profile.
create or replace function private.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end $$;
create trigger sync_profile_email after update of email on auth.users
  for each row execute function private.sync_profile_email();

-- ---------------------------------------------------------------------------
-- Builder branding
-- ---------------------------------------------------------------------------
create table public.builder_branding (
  builder_id uuid primary key references public.builders(id) on delete cascade,
  logo_path text,
  logo_updated_at timestamptz,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  website_url text check (website_url ~* '^https?://' and length(website_url) <= 300),
  tagline text check (length(tagline) <= 120),
  brand_notes text check (length(brand_notes) <= 2000),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function private.can_edit_branding(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'platform_admin'
      or (private.my_role() in ('builder_owner', 'manager', 'marketing') and b = private.my_builder_id())
$$;
revoke all on function private.can_edit_branding(uuid) from public, anon;
grant execute on function private.can_edit_branding(uuid) to authenticated;

alter table public.builder_branding enable row level security;
create policy "see your builder's branding" on public.builder_branding
  for select to authenticated using (private.can_see_builder(builder_id));
create policy "owners, managers, marketing add branding" on public.builder_branding
  for insert to authenticated with check (private.can_edit_branding(builder_id));
create policy "owners, managers, marketing edit branding" on public.builder_branding
  for update to authenticated using (private.can_edit_branding(builder_id)) with check (private.can_edit_branding(builder_id));

create or replace function public.builder_branding_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.logo_path is distinct from (case when tg_op = 'UPDATE' then old.logo_path end) then
    new.logo_updated_at := case when new.logo_path is null then null else now() end;
  end if;
  if new.logo_path is not null and split_part(new.logo_path, '/', 1) <> new.builder_id::text then
    raise exception 'The logo must be in this builder''s folder';
  end if;
  return new;
end $$;
create trigger builder_branding_touch before insert or update on public.builder_branding
  for each row execute function public.builder_branding_touch();

-- ---------------------------------------------------------------------------
-- Storage: two private buckets, images only, 5 MB each.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('branding', 'branding', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

-- Headshots: anyone who can see the person's profile can see the photo; only you change yours.
create policy "headshots: see if you can see the person" on storage.objects
  for select to authenticated using (
    bucket_id = 'profile-photos'
    and exists (select 1 from public.profiles p where p.id::text = (storage.foldername(name))[1])
  );
create policy "headshots: upload your own" on storage.objects
  for insert to authenticated with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "headshots: replace your own" on storage.objects
  for update to authenticated using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "headshots: remove your own" on storage.objects
  for delete to authenticated using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Logos: anyone who can see the builder can see the logo; owners, managers and marketing change it.
create policy "logos: see if you can see the builder" on storage.objects
  for select to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(name))[1])
  );
create policy "logos: upload for your builder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(name))[1] and private.can_edit_branding(b.id))
  );
create policy "logos: replace for your builder" on storage.objects
  for update to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(name))[1] and private.can_edit_branding(b.id))
  );
create policy "logos: remove for your builder" on storage.objects
  for delete to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(name))[1] and private.can_edit_branding(b.id))
  );

-- Every builder starts with an empty branding row.
insert into public.builder_branding (builder_id) select id from public.builders on conflict do nothing;
create or replace function private.builders_add_branding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.builder_branding (builder_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger builders_add_branding after insert on public.builders
  for each row execute function private.builders_add_branding();

-- Fix (same change): inside the builders lookups, "name" meant the builder's
-- name, not the file's. Point the policies at the file name explicitly.
drop policy "headshots: see if you can see the person" on storage.objects;
drop policy "logos: see if you can see the builder" on storage.objects;
drop policy "logos: upload for your builder" on storage.objects;
drop policy "logos: replace for your builder" on storage.objects;
drop policy "logos: remove for your builder" on storage.objects;

create policy "headshots: see if you can see the person" on storage.objects
  for select to authenticated using (
    bucket_id = 'profile-photos'
    and exists (select 1 from public.profiles p where p.id::text = (storage.foldername(objects.name))[1])
  );
create policy "logos: see if you can see the builder" on storage.objects
  for select to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(objects.name))[1])
  );
create policy "logos: upload for your builder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(objects.name))[1] and private.can_edit_branding(b.id))
  );
create policy "logos: replace for your builder" on storage.objects
  for update to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(objects.name))[1] and private.can_edit_branding(b.id))
  );
create policy "logos: remove for your builder" on storage.objects
  for delete to authenticated using (
    bucket_id = 'branding'
    and exists (select 1 from public.builders b where b.id::text = (storage.foldername(objects.name))[1] and private.can_edit_branding(b.id))
  );
