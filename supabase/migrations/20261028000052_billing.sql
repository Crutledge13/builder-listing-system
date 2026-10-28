-- Billing builders (owners' decisions, 28 Oct 2026).
--
-- Two plans, each with or without our photographer:
--   software         monthly software fee (default $4,000), billed ahead
--   listing_service  "Listing Service+": software included, a fee per listing
--                    charged when the builder approves it for the MLS, and a
--                    relist fee (default $150) when a paused or withdrawn
--                    live listing goes back on the market. Pausing is free.
-- Our photographer's shoots are charged to the builder from a builder price
-- list (separate from what we pay the photographer) when a request is
-- completed. Plus a one-time onboarding fee and admin adjustments (credits,
-- extras, special deals).
--
-- Nothing is charged at the moment it happens. Each event becomes a row in
-- billing_charges, and on the 1st of every month (6 am Central) a draft
-- invoice per builder collects that month's software fee plus last month's
-- usage. Our admins review the drafts and mark them sent. Prices are locked
-- on each charge when it's created, so changing a price later never changes
-- old charges.
--
-- Platform admins see and change everything. Builder owners see their own
-- plan, their sent invoices and charges not yet invoiced. Nobody else at the
-- builder (managers, marketing, sales) and no listing coordinator sees billing.

-- ---------------------------------------------------------------------------
-- Defaults (Admin > Billing). Amounts in cents.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values ('billing_defaults', jsonb_build_object(
  'software_fee_cents', 400000,
  'listing_fee_cents', 40000,
  'relist_fee_cents', 15000,
  'onboarding_fee_cents', 0,
  'net_days', 15,
  'photo_prices', jsonb_build_object(
    'photos', 25000, 'twilight', 12500, 'video', 35000, 'vertical_video', 25000,
    'drone', 20000, 'floor_plan', 17500, 'virtual_tour', 30000)
)) on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Each builder's plan and deal
-- ---------------------------------------------------------------------------
create table public.builder_billing (
  builder_id uuid primary key references public.builders (id) on delete cascade,
  plan text check (plan in ('software', 'listing_service')),   -- null = billing not set up
  includes_photos boolean not null default false,              -- plan includes our photographer
  starts_on date,                                              -- nothing is charged before this date
  -- This builder's own prices. Null = the default in Admin > Billing.
  software_fee_cents integer check (software_fee_cents >= 0),
  listing_fee_cents integer check (listing_fee_cents >= 0),
  relist_fee_cents integer check (relist_fee_cents >= 0),
  onboarding_fee_cents integer check (onboarding_fee_cents >= 0),
  photo_prices jsonb not null default '{}' check (jsonb_typeof(photo_prices) = 'object'),  -- {need: cents}
  net_days integer check (net_days between 0 and 90),
  deal_notes text check (length(deal_notes) <= 2000),         -- what was negotiated (our team only)
  quickbooks_customer_id text check (length(quickbooks_customer_id) <= 100),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.builder_billing enable row level security;
revoke all on public.builder_billing from anon;
create policy "admins see billing plans" on public.builder_billing
  for select to authenticated using (private.my_role() = 'platform_admin');
create policy "admins change billing plans" on public.builder_billing
  for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

create or replace function public.builder_billing_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke execute on function public.builder_billing_touch() from public, anon, authenticated;
create trigger builder_billing_touch before update on public.builder_billing
  for each row execute function public.builder_billing_touch();

insert into public.builder_billing (builder_id) select id from public.builders on conflict do nothing;

create or replace function private.builders_add_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.builder_billing (builder_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function private.builders_add_billing() from public, anon, authenticated;
create trigger builders_add_billing after insert on public.builders
  for each row execute function private.builders_add_billing();

-- Today in Central time (months reset on the 1st, Central).
create or replace function private.today_central() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Chicago')::date $$;
revoke execute on function private.today_central() from public, anon;
grant execute on function private.today_central() to authenticated;  -- column default below

-- A builder's price: their own, else the default.
create or replace function private.billing_price(p_builder uuid, p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    case p_key
      when 'software_fee_cents' then bb.software_fee_cents
      when 'listing_fee_cents' then bb.listing_fee_cents
      when 'relist_fee_cents' then bb.relist_fee_cents
      when 'onboarding_fee_cents' then bb.onboarding_fee_cents
      when 'net_days' then bb.net_days
    end,
    (select (value ->> p_key)::integer from public.app_settings where key = 'billing_defaults'),
    0)
  from public.builder_billing bb where bb.builder_id = p_builder
$$;
revoke execute on function private.billing_price(uuid, text) from public, anon, authenticated;

create or replace function private.billing_photo_price(p_builder uuid, p_need text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (bb.photo_prices ->> p_need)::integer,
    (select (value -> 'photo_prices' ->> p_need)::integer from public.app_settings where key = 'billing_defaults'),
    0)
  from public.builder_billing bb where bb.builder_id = p_builder
$$;
revoke execute on function private.billing_photo_price(uuid, text) from public, anon, authenticated;

-- The builder's plan if billing has started (else null): only then are events charged.
create or replace function private.billing_plan(p_builder uuid) returns text
language sql stable security definer set search_path = '' as $$
  select plan from public.builder_billing
  where builder_id = p_builder and plan is not null and starts_on is not null and starts_on <= private.today_central()
$$;
revoke execute on function private.billing_plan(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create sequence public.invoice_number_seq;
revoke all on sequence public.invoice_number_seq from public, anon, authenticated;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  period_month date not null check (extract(day from period_month) = 1),  -- the 1st it's issued for
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  number text unique,                                   -- given when sent
  total_cents integer not null default 0,
  issued_on date,
  due_on date,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id),
  paid_at timestamptz,
  paid_note text check (length(paid_note) <= 300),      -- check number, ACH reference
  voided_at timestamptz,
  void_reason text check (length(void_reason) <= 300),
  notes text check (length(notes) <= 1000),             -- printed on the invoice
  quickbooks_invoice_id text check (length(quickbooks_invoice_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invoices_one_per_month on public.invoices (builder_id, period_month) where status <> 'void';
create index invoices_builder_idx on public.invoices (builder_id, period_month desc);
alter table public.invoices enable row level security;
revoke all on public.invoices from anon;
create policy "admins see invoices, owners their sent ones" on public.invoices for select to authenticated
  using (private.my_role() = 'platform_admin'
         or (private.my_role() = 'builder_owner' and builder_id = private.my_builder_id() and status in ('sent', 'paid')));
create policy "admins change invoices" on public.invoices for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

-- ---------------------------------------------------------------------------
-- Charges: one row per billable event
-- ---------------------------------------------------------------------------
create table public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id),
  kind text not null check (kind in ('software', 'listing', 'relist', 'photos', 'onboarding', 'adjustment')),
  home_id uuid references public.homes (id),
  request_id uuid references public.media_requests (id),
  description text not null check (length(description) between 1 and 300),
  details jsonb not null default '[]',                  -- photo shoot items: [{need, label, amount_cents}]
  amount_cents integer not null,                        -- adjustments can be negative (credits)
  occurred_on date not null default private.today_central(),
  invoice_month date not null check (extract(day from invoice_month) = 1),  -- the first invoice it can go on
  invoice_id uuid references public.invoices (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (length(void_reason) <= 300)
);
-- Each of these is charged once, ever. A voided one stays voided (it was waived).
create unique index billing_charges_one_listing on public.billing_charges (home_id) where kind = 'listing';
create unique index billing_charges_one_shoot on public.billing_charges (request_id) where kind = 'photos';
create unique index billing_charges_one_software_month on public.billing_charges (builder_id, invoice_month) where kind = 'software';
create unique index billing_charges_one_onboarding on public.billing_charges (builder_id) where kind = 'onboarding';
create index billing_charges_builder_idx on public.billing_charges (builder_id, invoice_month) where invoice_id is null and voided_at is null;
create index billing_charges_invoice_idx on public.billing_charges (invoice_id);
alter table public.billing_charges enable row level security;
revoke all on public.billing_charges from anon;
create policy "admins see charges, owners their own" on public.billing_charges for select to authenticated
  using (private.my_role() = 'platform_admin'
         or (private.my_role() = 'builder_owner' and builder_id = private.my_builder_id() and voided_at is null));
create policy "admins add adjustments" on public.billing_charges for insert to authenticated
  with check (private.my_role() = 'platform_admin' and kind = 'adjustment');
create policy "admins void charges" on public.billing_charges for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

create or replace function private.billing_system_on() returns void language plpgsql set search_path = '' as $$
begin perform set_config('app.billing_system', 'on', true); end $$;
revoke execute on function private.billing_system_on() from public, anon, authenticated;

create or replace function private.billing_is_system() returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is null or coalesce(current_setting('app.billing_system', true), '') = 'on'
$$;
revoke execute on function private.billing_is_system() from public, anon, authenticated;

create or replace function private.invoice_recalc(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_invoice is null then return; end if;
  perform private.billing_system_on();
  update public.invoices set total_cents = coalesce((
      select sum(amount_cents) from public.billing_charges where invoice_id = p_invoice and voided_at is null), 0),
    updated_at = now()
  where id = p_invoice and status = 'draft';
end $$;
revoke execute on function private.invoice_recalc(uuid) from public, anon, authenticated;

-- What people may do to a charge: admins add adjustments and void charges that
-- aren't on a sent invoice. Everything else is the system's.
create or replace function public.billing_charges_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Charges are never deleted. Void it instead.';
  end if;
  if private.billing_is_system() then return new; end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'adjustment' then raise exception 'Only adjustments can be added by hand.'; end if;
    if new.amount_cents = 0 then raise exception 'An adjustment needs an amount.'; end if;
    new.invoice_id := null;
    new.home_id := null;
    new.request_id := null;
    new.details := '[]';
    new.voided_at := null; new.voided_by := null; new.void_reason := null;
    new.created_by := auth.uid();
    new.created_at := now();
    if new.invoice_month is null then
      -- The next invoice: this month's draft if it's still open, else next month's.
      new.invoice_month := case when exists (
          select 1 from public.invoices where builder_id = new.builder_id and status = 'draft'
            and period_month = date_trunc('month', private.today_central())::date)
        then date_trunc('month', private.today_central())::date
        else (date_trunc('month', private.today_central()) + interval '1 month')::date end;
    end if;
    return new;
  end if;

  -- UPDATE: only voiding (or un-voiding before it's invoiced).
  if (new.builder_id, new.kind, new.home_id, new.request_id, new.description, new.details, new.amount_cents,
      new.occurred_on, new.invoice_month, new.invoice_id, new.created_by, new.created_at)
     is distinct from
     (old.builder_id, old.kind, old.home_id, old.request_id, old.description, old.details, old.amount_cents,
      old.occurred_on, old.invoice_month, old.invoice_id, old.created_by, old.created_at) then
    raise exception 'Charges can''t be edited. Void it and add an adjustment.';
  end if;
  if old.invoice_id is not null then
    select status into st from public.invoices where id = old.invoice_id;
    if st in ('sent', 'paid') then
      raise exception 'That charge is on a sent invoice. Add a credit on the next invoice instead.';
    end if;
  end if;
  if new.voided_at is not null and old.voided_at is null then
    if coalesce(trim(new.void_reason), '') = '' then raise exception 'Say why it''s voided.'; end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  elsif new.voided_at is null and old.voided_at is not null then
    new.voided_by := null;
    new.void_reason := null;
  end if;
  return new;
end $$;
revoke execute on function public.billing_charges_guard() from public, anon, authenticated;
create trigger billing_charges_guard before insert or update or delete on public.billing_charges
  for each row execute function public.billing_charges_guard();

-- New charges go straight onto an open draft they belong on; totals follow changes.
create or replace function public.billing_charges_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d uuid;
begin
  if tg_op = 'INSERT' and new.invoice_id is null and new.voided_at is null then
    select id into d from public.invoices
      where builder_id = new.builder_id and status = 'draft' and period_month >= new.invoice_month
      order by period_month limit 1;
    if d is not null then
      perform private.billing_system_on();
      update public.billing_charges set invoice_id = d where id = new.id;
      return new;   -- the update above recalculates
    end if;
  end if;
  if tg_op = 'UPDATE' then
    perform private.invoice_recalc(old.invoice_id);
    if new.invoice_id is distinct from old.invoice_id then perform private.invoice_recalc(new.invoice_id); end if;
  elsif new.invoice_id is not null then
    perform private.invoice_recalc(new.invoice_id);
  end if;
  return new;
end $$;
revoke execute on function public.billing_charges_after() from public, anon, authenticated;
create trigger billing_charges_after after insert or update on public.billing_charges
  for each row execute function public.billing_charges_after();

-- What people may do to an invoice: send a draft, mark it paid (or back to
-- unpaid), void it with a reason, and edit its notes and QuickBooks number.
create or replace function public.invoices_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tg_op = 'DELETE' then
    if private.billing_is_system() and old.status = 'draft' then return old; end if;
    raise exception 'Invoices are never deleted. Void it instead.';
  end if;
  if private.billing_is_system() then return new; end if;

  if (new.builder_id, new.period_month, new.number, new.total_cents, new.issued_on, new.due_on, new.sent_at,
      new.sent_by, new.created_at)
     is distinct from
     (old.builder_id, old.period_month, old.number, old.total_cents, old.issued_on, old.due_on, old.sent_at,
      old.sent_by, old.created_at) then
    raise exception 'Only an invoice''s status, notes and QuickBooks number can be changed.';
  end if;
  if old.status = 'void' then raise exception 'A voided invoice can''t be changed.'; end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'sent' then
      select count(*) into n from public.billing_charges where invoice_id = new.id and voided_at is null;
      if n = 0 then raise exception 'This invoice has nothing on it.'; end if;
      new.issued_on := private.today_central();
      new.due_on := new.issued_on + private.billing_price(new.builder_id, 'net_days');
      new.number := 'INV-' || to_char(new.issued_on, 'YYYYMM') || '-' || lpad(nextval('public.invoice_number_seq')::text, 4, '0');
      new.sent_at := now();
      new.sent_by := auth.uid();
    elsif old.status = 'sent' and new.status = 'paid' then
      new.paid_at := now();
    elsif old.status = 'paid' and new.status = 'sent' then
      new.paid_at := null;
      new.paid_note := null;
    elsif new.status = 'void' then
      if coalesce(trim(new.void_reason), '') = '' then raise exception 'Say why it''s voided.'; end if;
      new.voided_at := now();
    else
      raise exception 'An invoice can''t go from % to %.', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.invoices_guard() from public, anon, authenticated;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function public.invoices_guard();

-- A voided invoice lets go of its charges, so they go on the next invoice.
create or replace function public.invoices_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'void' and old.status <> 'void' then
    perform private.billing_system_on();
    update public.billing_charges set invoice_id = null where invoice_id = new.id;
  end if;
  return new;
end $$;
revoke execute on function public.invoices_after() from public, anon, authenticated;
create trigger invoices_after after update of status on public.invoices
  for each row execute function public.invoices_after();

-- ---------------------------------------------------------------------------
-- Events that make charges
-- ---------------------------------------------------------------------------
-- Listing Service+: a home approved for the MLS (or put live without an
-- approval step) is charged its listing fee once.
create or replace function public.homes_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare fee int; today date := private.today_central();
begin
  if private.billing_plan(new.builder_id) is distinct from 'listing_service' then return new; end if;

  if new.workflow_status in ('approved_for_mls', 'live_on_mls')
     and (tg_op = 'INSERT' or old.workflow_status not in ('approved_for_mls', 'live_on_mls')) then
    fee := private.billing_price(new.builder_id, 'listing_fee_cents');
    if fee > 0 then
      perform private.billing_system_on();
      insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
      values (new.builder_id, 'listing', new.id, 'Listing: ' || coalesce(new.unparsed_address, 'home'), fee, today,
              (date_trunc('month', today) + interval '1 month')::date)
      on conflict (home_id) where kind = 'listing' do nothing;
    end if;
  end if;

  -- Relist: a paused or withdrawn live listing back on the market.
  if tg_op = 'UPDATE' and new.workflow_status = 'live_on_mls'
     and old.market_status in ('paused', 'withdrawn') and new.market_status = 'active' then
    fee := private.billing_price(new.builder_id, 'relist_fee_cents');
    if fee > 0 then
      perform private.billing_system_on();
      insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
      values (new.builder_id, 'relist', new.id,
              'Relist after ' || case old.market_status when 'paused' then 'pause' else 'withdrawal' end || ': '
                || coalesce(new.unparsed_address, 'home'),
              fee, today, (date_trunc('month', today) + interval '1 month')::date);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.homes_billing() from public, anon, authenticated;
create trigger homes_billing after insert or update of workflow_status, market_status on public.homes
  for each row execute function public.homes_billing();

-- Our photographer's shoot, charged from the builder price list when completed.
create or replace function public.media_requests_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
declare items jsonb; total int; labels text; today date := private.today_central();
begin
  if not (new.status = 'completed' and old.status <> 'completed') then return new; end if;
  if private.billing_plan(new.builder_id) is null then return new; end if;
  select coalesce(jsonb_agg(jsonb_build_object('need', n, 'label', coalesce(r.label, n),
           'amount_cents', private.billing_photo_price(new.builder_id, n)) order by ord), '[]'),
         coalesce(sum(private.billing_photo_price(new.builder_id, n)), 0),
         string_agg(coalesce(r.label, n), ', ' order by ord)
    into items, total, labels
  from unnest(new.needs) with ordinality as u(n, ord)
  left join public.photographer_rates r on r.need = u.n;
  if total <= 0 then return new; end if;
  perform private.billing_system_on();
  insert into public.billing_charges (builder_id, kind, home_id, request_id, description, details, amount_cents, occurred_on, invoice_month)
  values (new.builder_id, 'photos', new.home_id, new.id, left('Photo shoot: ' || new.address || ' (' || labels || ')', 300),
          items, total, today, (date_trunc('month', today) + interval '1 month')::date)
  on conflict (request_id) where kind = 'photos' do nothing;
  return new;
end $$;
revoke execute on function public.media_requests_billing() from public, anon, authenticated;
create trigger media_requests_billing after update of status on public.media_requests
  for each row execute function public.media_requests_billing();

-- ---------------------------------------------------------------------------
-- Building invoices
-- ---------------------------------------------------------------------------
-- One builder's draft for the invoice issued on p_month (a 1st): that month's
-- software fee, the onboarding fee if it hasn't been billed, and every
-- charge not yet invoiced that's due by then (last month's usage and older).
-- Safe to run again: it rebuilds the draft. A sent invoice is left alone.
create or replace function private.build_invoice(p_builder uuid, p_month date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare bb record; fee int; inv uuid; n int;
begin
  p_month := date_trunc('month', p_month)::date;
  select * into bb from public.builder_billing where builder_id = p_builder;
  if bb.plan is null or bb.starts_on is null or date_trunc('month', bb.starts_on)::date > p_month then return null; end if;
  if exists (select 1 from public.invoices where builder_id = p_builder and period_month = p_month and status in ('sent', 'paid')) then
    return null;
  end if;
  perform private.billing_system_on();

  if bb.plan = 'software' then
    fee := private.billing_price(p_builder, 'software_fee_cents');
    if fee > 0 then
      insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month)
      values (p_builder, 'software', 'Software, ' || to_char(p_month, 'FMMonth YYYY'), fee, p_month, p_month)
      on conflict (builder_id, invoice_month) where kind = 'software' do nothing;
    end if;
  end if;

  fee := private.billing_price(p_builder, 'onboarding_fee_cents');
  if fee > 0 then
    insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month)
    values (p_builder, 'onboarding', 'Onboarding and setup', fee, bb.starts_on, date_trunc('month', bb.starts_on)::date)
    on conflict (builder_id) where kind = 'onboarding' do nothing;
  end if;

  select id into inv from public.invoices where builder_id = p_builder and period_month = p_month and status = 'draft';
  if inv is null then
    insert into public.invoices (builder_id, period_month) values (p_builder, p_month) returning id into inv;
  end if;
  update public.billing_charges set invoice_id = null where invoice_id = inv;
  update public.billing_charges set invoice_id = inv
    where builder_id = p_builder and invoice_id is null and voided_at is null and invoice_month <= p_month;
  get diagnostics n = row_count;
  if n = 0 then
    delete from public.invoices where id = inv;
    return null;
  end if;
  perform private.invoice_recalc(inv);
  return inv;
end $$;
revoke execute on function private.build_invoice(uuid, date) from public, anon, authenticated;

-- Admins: build (or rebuild) drafts for one month, for every builder or one.
create or replace function public.build_invoices(p_month date default null, p_builder uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare b record; n int := 0; m date := date_trunc('month', coalesce(p_month, private.today_central()))::date;
begin
  if auth.uid() is not null and coalesce(private.my_role()::text, '') <> 'platform_admin' then
    raise exception 'Only platform admins can build invoices.';
  end if;
  for b in select builder_id from public.builder_billing where plan is not null and (p_builder is null or builder_id = p_builder) loop
    if private.build_invoice(b.builder_id, m) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.build_invoices(date, uuid) from public, anon;
grant execute on function public.build_invoices(date, uuid) to authenticated;

-- The 1st of the month: build every draft, then tell our admins.
create or replace function private.run_monthly_invoices() returns void
language plpgsql security definer set search_path = '' as $$
declare n int; p record; m date := date_trunc('month', private.today_central())::date;
begin
  n := public.build_invoices(m, null);
  if n > 0 then
    for p in select id from public.profiles where role = 'platform_admin' and is_active loop
      perform private.notify(p.id, 'billing', n || ' draft invoice' || case when n = 1 then '' else 's' end
        || ' ready for ' || to_char(m, 'FMMonth YYYY'),
        'Review them and mark each one sent.', '/admin/billing');
    end loop;
  end if;
end $$;
revoke execute on function private.run_monthly_invoices() from public, anon, authenticated;
select cron.schedule('monthly-invoices', '3 12 1 * *', $$select private.run_monthly_invoices()$$);

-- Builder owners: their plan and prices (without our deal notes).
create or replace function public.my_billing() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b uuid := private.my_builder_id(); bb record;
begin
  if coalesce(private.my_role()::text, '') <> 'builder_owner' or b is null then return null; end if;
  select * into bb from public.builder_billing where builder_id = b;
  if bb.plan is null then return jsonb_build_object('plan', null); end if;
  return jsonb_build_object(
    'plan', bb.plan,
    'includes_photos', bb.includes_photos,
    'starts_on', bb.starts_on,
    'software_fee_cents', case when bb.plan = 'software' then private.billing_price(b, 'software_fee_cents') end,
    'listing_fee_cents', case when bb.plan = 'listing_service' then private.billing_price(b, 'listing_fee_cents') end,
    'relist_fee_cents', case when bb.plan = 'listing_service' then private.billing_price(b, 'relist_fee_cents') end,
    'net_days', private.billing_price(b, 'net_days'),
    'photo_prices', (select coalesce(jsonb_agg(jsonb_build_object('need', r.need, 'label', r.label,
                       'amount_cents', private.billing_photo_price(b, r.need)) order by r.label), '[]')
                     from public.photographer_rates r));
end $$;
revoke execute on function public.my_billing() from public, anon;
grant execute on function public.my_billing() to authenticated;
