-- Speed pass (owners' request, 28 Oct 2026). No rule changes: who can see
-- or change what is exactly the same.
--
-- 1. Permission rules that call auth.uid() directly make Postgres work out
--    "who is asking" again for every row it checks. Wrapped as
--    (select auth.uid()) it's worked out once per query (Supabase's own
--    advice, database health report "auth_rls_initplan"). This rewrites only
--    that call inside each rule, in place; the rest of each rule is untouched.
do $$
declare
  p record;
  q text;
  c text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ '(?<!SELECT )auth\.uid\(\)' or with_check ~ '(?<!SELECT )auth\.uid\(\)')
  loop
    q := regexp_replace(p.qual, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    c := regexp_replace(p.with_check, '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
      || case when q is not null then format(' using (%s)', q) else '' end
      || case when c is not null then format(' with check (%s)', c) else '' end;
  end loop;
end $$;

-- 2. Indexes on the columns pages filter by (each builder's tasks, a home's
--    requests, a community's alerts...). Columns that only record who did
--    something (created_by, updated_by) aren't looked up, so they're left out.
create index if not exists tasks_builder_idx on public.tasks (builder_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_community_idx on public.tasks (community_id);
create index if not exists builder_tasks_home_idx on public.builder_tasks (home_id);
create index if not exists builder_tasks_community_idx on public.builder_tasks (community_id);
create index if not exists builder_tasks_assignee_idx on public.builder_tasks (assignee_id);
create index if not exists media_requests_community_idx on public.media_requests (community_id);
create index if not exists media_uploaded_by_idx on public.media (uploaded_by);
create index if not exists comp_requests_home_idx on public.comp_requests (home_id);
create index if not exists comp_requests_community_idx on public.comp_requests (community_id);
create index if not exists comp_requests_requested_by_idx on public.comp_requests (requested_by);
create index if not exists mls_details_builder_idx on public.mls_details (builder_id);
create index if not exists mls_listings_home_idx on public.mls_listings (home_id);
create index if not exists mls_listings_builder_idx on public.mls_listings (builder_id);
create index if not exists share_links_builder_idx on public.share_links (builder_id);
create index if not exists virtual_tours_builder_idx on public.virtual_tours (builder_id);
create index if not exists open_house_series_builder_idx on public.open_house_series (builder_id);
create index if not exists open_houses_series_idx on public.open_houses (series_id);
create index if not exists home_alerts_community_idx on public.home_alerts (community_id);
create index if not exists reverse_prospect_requests_builder_idx on public.reverse_prospect_requests (builder_id);
create index if not exists photographer_payments_photographer_idx on public.photographer_payments (photographer_id);
create index if not exists deliverable_files_builder_idx on public.deliverable_files (builder_id);
create index if not exists issue_reports_builder_idx on public.issue_reports (builder_id);
create index if not exists issue_reports_reported_by_idx on public.issue_reports (reported_by);
create index if not exists media_tag_requests_requested_by_idx on public.media_tag_requests (requested_by);
create index if not exists media_tag_requests_builder_idx on public.media_tag_requests (builder_id);
create index if not exists join_links_builder_idx on public.join_links (builder_id);
create index if not exists homes_mls_board_idx on public.homes (mls_board);
create index if not exists communities_mls_board_idx on public.communities (mls_board);

-- 3. Housekeeping from the database's security report: two trigger functions
--    were still callable directly (harmless, since Postgres refuses to run a
--    trigger function outside its trigger, but the project rule is to lock
--    them). Their triggers keep firing.
revoke execute on function public.join_links_prepare() from public, anon, authenticated;
revoke execute on function public.staff_builders_guard() from public, anon, authenticated;
