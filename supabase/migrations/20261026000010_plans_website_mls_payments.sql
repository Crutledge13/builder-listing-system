-- Plan photo library, builder website feed, MLS feed data (read-only), and
-- photographer payments (demo only: no money moves).

-- ===========================================================================
-- Plan media: photos/video/floor plan for a floor plan (not one home). Used
-- automatically for homes that aren't built yet.
-- ===========================================================================
alter table public.media add column plan_name text;
create index media_plan_idx on public.media (builder_id, plan_name) where plan_name is not null and deleted_at is null;

create or replace function public.media_prepare()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  h record;
  c record;
  auto text[] := '{}';
begin
  if new.home_id is not null then
    select id, builder_id, community_id, unparsed_address, plan_name into h from public.homes where id = new.home_id;
    if h.id is null then raise exception 'Unknown home'; end if;
    new.builder_id := h.builder_id;
    new.community_id := h.community_id;
    new.plan_name := null;  -- a home's own media isn't plan media
    auto := auto || array_remove(array[h.unparsed_address, case when h.plan_name is not null then h.plan_name || ' plan' end], null);
  end if;
  if new.community_id is not null then
    select id, builder_id, name into c from public.communities where id = new.community_id;
    if c.id is null then raise exception 'Unknown community'; end if;
    if new.builder_id is distinct from c.builder_id then
      if tg_op = 'INSERT' and new.home_id is null then new.builder_id := c.builder_id;
      else raise exception 'That community belongs to a different builder'; end if;
    end if;
    auto := auto || c.name;
  end if;
  if new.plan_name is not null then
    auto := auto || array[new.plan_name || ' plan', 'representative'];
  end if;
  if new.room is not null then
    auto := auto || replace(replace(replace(new.room, 'primary_', 'primary '), '_', ' '), 'living', 'living room');
  end if;

  select coalesce(array_agg(t order by min_ord), '{}') into new.tags from (
    select min(ord) as min_ord, (array_agg(trim(t) order by ord))[1] as t
    from unnest(new.tags || auto) with ordinality as u(t, ord)
    where trim(t) <> ''
    group by lower(trim(t))
  ) x;

  new.search_text := lower(concat_ws(' ', new.title, new.caption, new.room, array_to_string(new.tags, ' ')));
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  end if;
  return new;
end $$;

-- ===========================================================================
-- Builder website feed
-- ===========================================================================
create table public.builder_settings (
  builder_id uuid primary key references public.builders (id),
  website_url text,
  website_feed_enabled boolean not null default false,
  website_feed_source text check (website_feed_source in ('listing_feed', 'website_platform', 'page_reader', 'spreadsheet')),
  website_feed_last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.builder_settings enable row level security;
revoke all on public.builder_settings from anon;
create policy "see builder settings" on public.builder_settings for select to authenticated
  using (private.is_staff() or builder_id = private.my_builder_id());
create policy "owners, managers and admins change builder settings" on public.builder_settings for all to authenticated
  using (private.my_role() = 'platform_admin' or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager')))
  with check (private.my_role() = 'platform_admin' or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager')));

-- Homes as they appear on the builder's own website (written by the feed).
create table public.website_listings (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  external_id text not null,
  unparsed_address text not null,
  city text,
  postal_code text,
  community_name text,
  plan_name text,
  list_price numeric(12, 2),
  bedrooms_total smallint,
  bathrooms_full smallint,
  bathrooms_half smallint,
  living_area integer,
  public_remarks text,
  status_text text,              -- as the website words it ("Move-in ready", "Under construction")
  url text,
  home_id uuid references public.homes (id),
  dismissed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (builder_id, external_id)
);
create index website_listings_home_idx on public.website_listings (home_id);
alter table public.website_listings enable row level security;
revoke all on public.website_listings from anon;
create policy "see website listings" on public.website_listings for select to authenticated
  using (private.is_staff() or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));
create policy "link or dismiss website listings" on public.website_listings for update to authenticated
  using (private.my_role() = 'platform_admin' or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')))
  with check (private.my_role() = 'platform_admin' or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));

-- ===========================================================================
-- MLS listings from the MLS's read-only feed. We never write to the MLS; this
-- is only what the MLS reports back, for checking.
-- ===========================================================================
create table public.mls_listings (
  listing_id text primary key,       -- RESO ListingId
  home_id uuid references public.homes (id),
  builder_id uuid references public.builders (id),
  unparsed_address text,
  list_price numeric(12, 2),
  bedrooms_total smallint,
  bathrooms_full smallint,
  bathrooms_half smallint,
  living_area integer,
  public_remarks text,
  standard_status text,              -- RESO StandardStatus as the MLS reports it
  modification_timestamp timestamptz,
  fetched_at timestamptz not null default now()
);
alter table public.mls_listings enable row level security;
revoke all on public.mls_listings from anon;
create policy "see MLS data for your homes" on public.mls_listings for select to authenticated
  using (private.is_staff() or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));
-- No insert/update policies: only the feed (with the server key) writes here.

-- ===========================================================================
-- Photographer payments (demo)
-- ===========================================================================
create table public.photographer_rates (
  need text primary key,
  amount_cents integer not null check (amount_cents >= 0),
  label text not null
);
alter table public.photographer_rates enable row level security;
revoke all on public.photographer_rates from anon;
create policy "staff and photographers see rates" on public.photographer_rates for select to authenticated
  using (private.is_staff() or private.my_role() = 'photographer');
create policy "admins change rates" on public.photographer_rates for all to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');
insert into public.photographer_rates (need, amount_cents, label) values
  ('photos', 15000, 'Photo shoot'), ('twilight', 7500, 'Twilight add-on'), ('video', 20000, 'Video walkthrough'),
  ('drone', 12500, 'Drone or aerial'), ('floor_plan', 10000, 'Floor plan'), ('virtual_tour', 17500, '3D virtual tour')
on conflict (need) do nothing;

create table public.photographer_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.media_requests (id),
  photographer_id uuid not null references public.profiles (id),
  address text not null,
  line_items jsonb not null default '[]',   -- [{need, label, amount_cents}]
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid')),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
alter table public.photographer_payments enable row level security;
revoke all on public.photographer_payments from anon;
create policy "photographers see their payments, staff all" on public.photographer_payments for select to authenticated
  using (private.is_staff() or photographer_id = auth.uid());
create policy "admins approve and pay" on public.photographer_payments for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

create or replace function public.photographer_payments_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status = 'pending' then new.approved_at := now(); new.approved_by := auth.uid(); end if;
  if new.status = 'paid' and old.status <> 'paid' then new.paid_at := now();
    if new.approved_at is null then new.approved_at := now(); new.approved_by := auth.uid(); end if;
  end if;
  return new;
end $$;
revoke execute on function public.photographer_payments_touch() from public, anon, authenticated;
create trigger photographer_payments_touch before update on public.photographer_payments
  for each row execute function public.photographer_payments_touch();

-- When a shoot is completed, the photographer's payment is created from the rate card.
create or replace function public.media_requests_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare items jsonb; total int;
begin
  if new.status = 'completed' and old.status <> 'completed' and new.photographer_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('need', r.need, 'label', r.label, 'amount_cents', r.amount_cents)), '[]'),
           coalesce(sum(r.amount_cents), 0)
      into items, total
    from unnest(new.needs) n join public.photographer_rates r on r.need = n;
    insert into public.photographer_payments (request_id, photographer_id, address, line_items, amount_cents)
    values (new.id, new.photographer_id, new.address, items, total)
    on conflict (request_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.media_requests_payment() from public, anon, authenticated;
create trigger media_requests_payment after update on public.media_requests
  for each row execute function public.media_requests_payment();
