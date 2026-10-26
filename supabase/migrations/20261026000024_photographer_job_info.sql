-- Photographer job cards: who the builder is (name and logo), who to call
-- with a problem, and a full address for maps.
--
-- Photographers still can't read homes, builders, profiles or branding. They
-- get exactly these facts for their own jobs through one function.

-- Each builder's contact for photo shoots (often marketing), set by the builder.
create table public.builder_photo_info (
  builder_id uuid primary key references public.builders(id) on delete cascade,
  contact_name text check (length(contact_name) <= 80),
  contact_phone text check (length(contact_phone) <= 30),
  contact_email text check (length(contact_email) <= 200),
  access_notes text check (length(access_notes) <= 1000),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.builder_photo_info enable row level security;
create policy "builder team sees its photo contact" on public.builder_photo_info
  for select to authenticated using (private.can_see_builder(builder_id));
create policy "owners, managers, marketing set photo contact" on public.builder_photo_info
  for insert to authenticated with check (private.can_edit_branding(builder_id));
create policy "owners, managers, marketing change photo contact" on public.builder_photo_info
  for update to authenticated using (private.can_edit_branding(builder_id)) with check (private.can_edit_branding(builder_id));

insert into public.builder_photo_info (builder_id) select id from public.builders on conflict do nothing;
create or replace function private.builders_add_branding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.builder_branding (builder_id) values (new.id) on conflict do nothing;
  insert into public.builder_photo_info (builder_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- Our team's phone for photographers (email is already team_email).
insert into public.app_settings (key, value) values ('team_phone', '""') on conflict (key) do nothing;

-- Everything a photographer's job card needs, for their own jobs only.
create or replace function public.my_job_info()
returns table (
  request_id uuid,
  builder_id uuid,
  builder_name text,
  logo_updated_at timestamptz,
  map_query text,
  builder_contact_name text,
  builder_contact_phone text,
  builder_contact_email text,
  access_notes text,
  requester_name text,
  requester_title text,
  requester_phone text,
  requester_email text
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.builder_id, b.name, bb.logo_updated_at,
    -- The copied address sometimes already ends with the city.
    concat_ws(', ', r.address,
      case when r.address ilike '%' || coalesce(h.city, c.city) || '%' then null else coalesce(h.city, c.city) end,
      trim('TX ' || coalesce(h.postal_code, ''))),
    pi.contact_name, pi.contact_phone, pi.contact_email, pi.access_notes,
    p.full_name, p.job_title, p.phone, p.email
  from public.media_requests r
  join public.builders b on b.id = r.builder_id
  join public.communities c on c.id = r.community_id
  left join public.homes h on h.id = r.home_id
  left join public.builder_branding bb on bb.builder_id = r.builder_id
  left join public.builder_photo_info pi on pi.builder_id = r.builder_id
  left join public.profiles p on p.id = r.requested_by and p.is_active
  where r.photographer_id = auth.uid() and private.my_role() = 'photographer'
$$;
revoke all on function public.my_job_info() from public, anon;
grant execute on function public.my_job_info() to authenticated;

-- Photographers may see the logo of a builder they have (or had) a job with.
create or replace function private.photographer_sees_logo(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'photographer' and exists (
    select 1 from public.builder_branding bb
    join public.media_requests r on r.builder_id = bb.builder_id
    where bb.logo_path = path and r.photographer_id = auth.uid()
  )
$$;
revoke all on function private.photographer_sees_logo(text) from public, anon;
grant execute on function private.photographer_sees_logo(text) to authenticated;

create or replace function public.job_logo_path(p_builder uuid) returns text
language sql stable security definer set search_path = '' as $$
  select bb.logo_path from public.builder_branding bb
  where bb.builder_id = p_builder and private.photographer_sees_logo(bb.logo_path)
$$;
revoke all on function public.job_logo_path(uuid) from public, anon;
grant execute on function public.job_logo_path(uuid) to authenticated;

create policy "logos: photographers on that builder's jobs" on storage.objects
  for select to authenticated using (bucket_id = 'branding' and private.photographer_sees_logo(objects.name));
