-- AI credits: each builder gets a monthly allowance of AI credits.
--
--   Photo labeled on upload ........ 1 credit   (costs us about $0.0003)
--   Floor plan read ............... 25 credits  (about $0.02-$0.04)
--   Brand guide read .............. 25 credits  (about $0.02-$0.05)
--
-- The allowance resets on the 1st of each month (Central time). The default
-- (app_settings.ai_credits_default, 2,500) covers about 2,500 photos or 100
-- plans a month; our admins can give a builder a different allowance or extra
-- credits for one month. Work our own team and photographers do on a builder's
-- files is logged but never counts against the builder's credits.
--
-- Every AI call is logged in ai_usage with the real tokens and dollar cost
-- (from app_settings.ai_prices), so we can check the credit prices against
-- what we actually pay. Rows are written only through ai_spend / ai_finish.
-- When a builder is out of credits, uploads still work; AI just doesn't run.

insert into public.app_settings (key, value) values
  ('ai_credits_default', '2500'),
  ('ai_credit_costs', '{"photo_label": 1, "plan_read": 25, "brand_guide_read": 25}'),
  -- Dollars per million tokens (input, output). Update if Anthropic's prices change.
  ('ai_prices', '{"claude-haiku-5-5": {"in": 0.10, "out": 0.50}, "claude-sonnet-5-5": {"in": 2.00, "out": 10.00}}')
on conflict (key) do nothing;

-- A builder's own allowance (no row = the default). Our admins set it.
create table public.ai_allowances (
  builder_id uuid primary key references public.builders(id),
  monthly_credits int not null check (monthly_credits between 0 and 1000000),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.ai_allowances enable row level security;
revoke all on public.ai_allowances from anon;
create policy "see AI allowance" on public.ai_allowances for select to authenticated
  using (private.is_staff() or builder_id = private.my_builder_id());
create policy "admins set AI allowance" on public.ai_allowances for all to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

-- Extra credits for one month (a top-up). Our admins add them.
create table public.ai_credit_grants (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  month date not null check (extract(day from month) = 1),
  credits int not null check (credits between 1 and 1000000),
  note text check (length(note) <= 200),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index ai_credit_grants_builder on public.ai_credit_grants (builder_id, month);
alter table public.ai_credit_grants enable row level security;
revoke all on public.ai_credit_grants from anon;
create policy "see AI top-ups" on public.ai_credit_grants for select to authenticated
  using (private.is_staff() or builder_id = private.my_builder_id());
create policy "admins add AI top-ups" on public.ai_credit_grants for insert to authenticated
  with check (private.my_role() = 'platform_admin' and created_by = auth.uid());

-- One row per AI call.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders(id),
  kind text not null check (kind in ('photo_label', 'plan_read', 'brand_guide_read')),
  credits int not null check (credits >= 0),
  counts boolean not null,              -- false when our team or a photographer ran it
  status text not null default 'reserved' check (status in ('reserved', 'done', 'refunded')),
  ref_id uuid,                          -- the photo, plan or builder it was for
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 6),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ai_usage_builder_month on public.ai_usage (builder_id, created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon;
-- Our staff see every builder's usage; owners and managers see their own.
create policy "see AI usage" on public.ai_usage for select to authenticated
  using (private.is_staff() or (private.my_role() in ('builder_owner', 'manager') and builder_id = private.my_builder_id()));
-- No insert/update/delete policies: only ai_spend and ai_finish write here.

-- Photos can now be skipped for lack of credits.
alter table public.media drop constraint if exists media_ai_status_check;
alter table public.media add constraint media_ai_status_check
  check (ai_status in ('pending', 'done', 'skipped', 'failed', 'no_credits'));

-- The first of this month, Central time.
create or replace function private.ai_month() returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', now() at time zone 'America/Chicago')::date
$$;
revoke all on function private.ai_month() from public, anon;
grant execute on function private.ai_month() to authenticated;

-- This month's credits for a builder (no access check: callers check).
create or replace function private.ai_credit_numbers(p_builder uuid)
returns table (month date, allowance int, extra int, used int)
language sql stable security definer set search_path = '' as $$
  select private.ai_month(),
    coalesce((select monthly_credits from public.ai_allowances where builder_id = p_builder),
             (select (value #>> '{}')::int from public.app_settings where key = 'ai_credits_default'), 0),
    coalesce((select sum(credits)::int from public.ai_credit_grants where builder_id = p_builder and month = private.ai_month()), 0),
    coalesce((select sum(credits)::int from public.ai_usage u
              where u.builder_id = p_builder and u.counts
                and u.created_at >= (private.ai_month()::timestamp at time zone 'America/Chicago')
                -- a reservation left behind by a crash stops counting after an hour
                and (u.status = 'done' or (u.status = 'reserved' and u.created_at > now() - interval '1 hour'))), 0)
$$;
revoke all on function private.ai_credit_numbers(uuid) from public, anon, authenticated;

-- Who may spend or look at a builder's credits: our staff, the builder's own
-- people, and photographers with a job for that builder.
create or replace function private.can_use_builder_ai(p_builder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (private.my_role() in ('builder_owner', 'manager', 'marketing', 'sales') and p_builder = private.my_builder_id())
      or (private.my_role() = 'photographer' and exists (
            select 1 from public.media_requests r where r.builder_id = p_builder and r.photographer_id = auth.uid()))
$$;
revoke all on function private.can_use_builder_ai(uuid) from public, anon;
grant execute on function private.can_use_builder_ai(uuid) to authenticated;

-- The meter: { month, allowance, extra, used, left, costs, resets_on }.
create or replace function public.ai_credit_status(p_builder uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n record;
begin
  if not private.can_use_builder_ai(p_builder) or private.my_role() = 'photographer' then return null; end if;
  select * into n from private.ai_credit_numbers(p_builder);
  return jsonb_build_object(
    'month', n.month, 'allowance', n.allowance, 'extra', n.extra, 'used', n.used,
    'left', greatest(n.allowance + n.extra - n.used, 0),
    'costs', (select value from public.app_settings where key = 'ai_credit_costs'),
    'resets_on', (n.month + interval '1 month')::date);
end $$;
revoke all on function public.ai_credit_status(uuid) from public, anon;
grant execute on function public.ai_credit_status(uuid) to authenticated;

-- Reserve credits before an AI call. Returns the usage id, or null when the
-- builder doesn't have enough credits left. Our staff and photographers always
-- go ahead, logged as not counting.
create or replace function public.ai_spend(p_builder uuid, p_kind text, p_ref uuid default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare cost int; counted boolean; n record; new_id uuid;
begin
  if auth.uid() is null or not private.can_use_builder_ai(p_builder) then
    raise exception 'You can''t use AI for this builder';
  end if;
  cost := ((select value from public.app_settings where key = 'ai_credit_costs') ->> p_kind)::int;
  if cost is null then raise exception 'Unknown AI action %', p_kind; end if;
  counted := not (private.is_staff() or private.my_role() = 'photographer');
  if counted then
    -- One spender at a time per builder, so two uploads can't both take the last credits.
    perform pg_advisory_xact_lock(hashtext('ai_credits:' || p_builder::text));
    select * into n from private.ai_credit_numbers(p_builder);
    if n.allowance + n.extra - n.used < cost then return null; end if;
  end if;
  insert into public.ai_usage (builder_id, kind, credits, counts, ref_id)
    values (p_builder, p_kind, cost, counted, p_ref) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.ai_spend(uuid, text, uuid) from public, anon;
grant execute on function public.ai_spend(uuid, text, uuid) to authenticated;

-- After the call: record tokens and cost, or give the credits back if it failed.
create or replace function public.ai_finish(p_usage uuid, p_ok boolean, p_model text default null,
  p_input_tokens int default null, p_output_tokens int default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare price jsonb;
begin
  price := (select value from public.app_settings where key = 'ai_prices') -> p_model;
  update public.ai_usage set
    status = case when p_ok then 'done' else 'refunded' end,
    model = p_model,
    input_tokens = greatest(p_input_tokens, 0),
    output_tokens = greatest(p_output_tokens, 0),
    cost_usd = case when price is not null then
      (coalesce(p_input_tokens, 0) * (price ->> 'in')::numeric + coalesce(p_output_tokens, 0) * (price ->> 'out')::numeric) / 1000000 end,
    finished_at = now()
  where id = p_usage and created_by = auth.uid() and status = 'reserved';
end $$;
revoke all on function public.ai_finish(uuid, boolean, text, int, int) from public, anon;
grant execute on function public.ai_finish(uuid, boolean, text, int, int) to authenticated;

-- Admin overview: this month per builder, with what it really cost us.
create or replace function public.ai_usage_summary() returns table (
  builder_id uuid, builder_name text, allowance int, extra int, used int,
  photos int, plans int, guides int, cost_usd numeric, team_cost_usd numeric)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name, n.allowance, n.extra, n.used,
    count(*) filter (where u.kind = 'photo_label' and u.status = 'done')::int,
    count(*) filter (where u.kind = 'plan_read' and u.status = 'done')::int,
    count(*) filter (where u.kind = 'brand_guide_read' and u.status = 'done')::int,
    coalesce(sum(u.cost_usd) filter (where u.counts), 0),
    coalesce(sum(u.cost_usd) filter (where not u.counts), 0)
  from public.builders b
  cross join lateral private.ai_credit_numbers(b.id) n
  left join public.ai_usage u on u.builder_id = b.id
    and u.created_at >= (private.ai_month()::timestamp at time zone 'America/Chicago')
  where private.is_staff()
  group by b.id, b.name, n.allowance, n.extra, n.used
  order by b.name
$$;
revoke all on function public.ai_usage_summary() from public, anon;
grant execute on function public.ai_usage_summary() to authenticated;

-- ===========================================================================
-- Builders set up their own floor plans (owners, managers, marketing), as
-- well as our team. Same people who keep the builder's media and branding.
-- ===========================================================================
drop policy "our team adds floor plans" on public.floor_plans;
drop policy "our team changes floor plans" on public.floor_plans;
create policy "add floor plans" on public.floor_plans for insert to authenticated
  with check (private.is_staff() or private.can_edit_branding(builder_id));
create policy "change floor plans" on public.floor_plans for update to authenticated
  using (private.is_staff() or private.can_edit_branding(builder_id))
  with check (private.is_staff() or private.can_edit_branding(builder_id));

drop policy "plan files: our team uploads" on storage.objects;
create policy "plan files: our team and the builder upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'plan-files' and (
      private.is_staff()
      or (private.my_role() in ('builder_owner', 'manager', 'marketing')
          and (storage.foldername(name))[1] = private.my_builder_id()::text)));
