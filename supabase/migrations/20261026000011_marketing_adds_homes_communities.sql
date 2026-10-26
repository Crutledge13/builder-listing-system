-- Marketing can add homes (as drafts) and communities for their own builder.
-- Editing rules after that are unchanged (marketing still can't change prices).
alter policy "builder editors add homes" on public.homes
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing')
        and private.can_see_home(builder_id, community_id)
        and workflow_status = 'draft' and mls_number is null and deleted_at is null)
  );

alter policy "owners and managers add communities" on public.communities
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
  );
