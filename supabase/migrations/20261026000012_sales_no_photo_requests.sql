-- Sales view and download media but don't request or manage photo shoots.
alter policy "builder team and admins request" on public.media_requests
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
  );

alter policy "update requests" on public.media_requests
  using (
    private.my_role() = 'platform_admin'
    or photographer_id = auth.uid()
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
  )
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() = 'photographer' and photographer_id = auth.uid())
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
  );

alter policy "see requests: staff all, builder their own, photographer their " on public.media_requests
  using (
    private.is_staff()
    or photographer_id = auth.uid()
    or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing'))
  );
