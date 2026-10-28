-- Demo billing (TEST project only). Run after demo_tasks.sql.
--
-- Mesquite Creek is on Listing Service+ with our photographer, at a
-- negotiated $350 per listing. Prairie Lantern is on Software, with a
-- one-time onboarding fee. Both started billing two months ago, so each has a
-- sent invoice from the start of this month (Mesquite paid, Prairie unpaid and
-- overdue) and charges adding up for next month's invoice. Dates are relative
-- to today so the demo always looks current.
do $$
declare
  mc uuid; pl uuid;
  this_m date := date_trunc('month', (now() at time zone 'America/Chicago'))::date;
  last_m date := (date_trunc('month', (now() at time zone 'America/Chicago')) - interval '1 month')::date;
  next_m date := (date_trunc('month', (now() at time zone 'America/Chicago')) + interval '1 month')::date;
  h record; i int := 0; inv uuid;
begin
  select id into mc from public.builders where name = 'Mesquite Creek Homes (demo)';
  select id into pl from public.builders where name = 'Prairie Lantern Builders (demo)';
  if mc is null or pl is null then raise notice 'Demo builders not found; skipping billing demo'; return; end if;
  perform set_config('app.billing_system', 'on', true);

  update public.builder_billing set plan = 'listing_service', includes_photos = true, starts_on = last_m,
    listing_fee_cents = 35000, net_days = 15,
    deal_notes = 'Pilot pricing: $350 per listing for the first year (standard $400). Relists at standard $150.'
  where builder_id = mc;
  update public.builder_billing set plan = 'software', includes_photos = true, starts_on = last_m,
    onboarding_fee_cents = 250000, net_days = 15,
    deal_notes = 'Software at standard $4,000/month. Onboarding $2,500, billed on the first invoice.'
  where builder_id = pl;

  -- Last month's usage (on this month's invoice).
  for h in select id, unparsed_address from public.homes where builder_id = mc and deleted_at is null
             and workflow_status in ('approved_for_mls', 'live_on_mls') order by unparsed_address limit 4 loop
    i := i + 1;
    insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
    values (mc, 'listing', h.id, 'Listing: ' || h.unparsed_address, 35000, last_m + (i * 5), this_m)
    on conflict do nothing;
  end loop;
  select id, unparsed_address into h from public.homes where builder_id = mc and deleted_at is null and workflow_status = 'live_on_mls' order by unparsed_address limit 1;
  if h.id is not null then
    insert into public.billing_charges (builder_id, kind, home_id, description, details, amount_cents, occurred_on, invoice_month)
    values (mc, 'photos', h.id, 'Photo shoot: ' || h.unparsed_address || ' (Photo shoot, Twilight add-on)',
      '[{"need":"photos","label":"Photo shoot","amount_cents":25000},{"need":"twilight","label":"Twilight add-on","amount_cents":12500}]',
      37500, last_m + 8, this_m);
  end if;

  select id, unparsed_address into h from public.homes where builder_id = pl and deleted_at is null order by unparsed_address limit 1;
  insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month) values
    (pl, 'onboarding', 'Onboarding and setup', 250000, last_m, last_m),
    (pl, 'software', 'Software, ' || to_char(last_m, 'FMMonth YYYY'), 400000, last_m, last_m),
    (pl, 'software', 'Software, ' || to_char(this_m, 'FMMonth YYYY'), 400000, this_m, this_m)
  on conflict do nothing;
  if h.id is not null then
    insert into public.billing_charges (builder_id, kind, home_id, description, details, amount_cents, occurred_on, invoice_month)
    values (pl, 'photos', h.id, 'Photo shoot: ' || h.unparsed_address || ' (Photo shoot, Drone or aerial)',
      '[{"need":"photos","label":"Photo shoot","amount_cents":25000},{"need":"drone","label":"Drone or aerial","amount_cents":20000}]',
      45000, last_m + 12, this_m);
  end if;
  -- A launch credit.
  insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month)
  values (pl, 'adjustment', 'Launch credit: first month of software half off', -200000, last_m, last_m);

  -- Last month's invoice for Prairie (paid), and this month's for both (sent).
  insert into public.invoices (builder_id, period_month) values (pl, last_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = pl and invoice_month = last_m;
  perform private.invoice_recalc(inv);
  update public.invoices set status = 'paid', number = 'INV-' || to_char(last_m, 'YYYYMM') || '-0001',
    issued_on = last_m, due_on = last_m + 15, sent_at = last_m + time '09:00', paid_at = last_m + 9 + time '14:00',
    paid_note = 'ACH received' where id = inv;

  insert into public.invoices (builder_id, period_month) values (mc, this_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = mc and invoice_month = this_m;
  perform private.invoice_recalc(inv);
  update public.invoices set status = 'paid', number = 'INV-' || to_char(this_m, 'YYYYMM') || '-0002',
    issued_on = this_m, due_on = this_m + 15, sent_at = this_m + time '09:00', paid_at = this_m + 6 + time '11:00',
    paid_note = 'Check 1042' where id = inv;

  insert into public.invoices (builder_id, period_month) values (pl, this_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = pl and invoice_month = this_m;
  perform private.invoice_recalc(inv);
  update public.invoices set status = 'sent', number = 'INV-' || to_char(this_m, 'YYYYMM') || '-0003',
    issued_on = this_m, due_on = this_m + 15, sent_at = this_m + time '09:00' where id = inv;
  perform setval('public.invoice_number_seq', 3);

  -- This month so far (on next month's invoice).
  i := 0;
  for h in select id, unparsed_address from public.homes where builder_id = mc and deleted_at is null
             and workflow_status in ('approved_for_mls', 'live_on_mls')
             and id not in (select home_id from public.billing_charges where kind = 'listing' and home_id is not null)
           order by unparsed_address limit 2 loop
    i := i + 1;
    insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
    values (mc, 'listing', h.id, 'Listing: ' || h.unparsed_address, 35000, this_m + (i * 4), next_m)
    on conflict do nothing;
  end loop;
  select id, unparsed_address into h from public.homes where builder_id = mc and deleted_at is null and workflow_status = 'live_on_mls' order by unparsed_address offset 1 limit 1;
  if h.id is not null then
    insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
    values (mc, 'relist', h.id, 'Relist after pause: ' || h.unparsed_address, 15000, this_m + 10, next_m);
  end if;
end $$;
