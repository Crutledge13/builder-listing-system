-- Trigger functions run automatically when rows change; nobody should call
-- them directly through the API. Supabase grants EXECUTE on new public
-- functions to everyone by default, so take it back. Triggers still fire:
-- Postgres doesn't check EXECUTE when a trigger runs (tested 28 Oct 2026).
--
-- Left as they are on purpose (Supabase's advisor still lists them):
-- - share_page, share_file, share_logo, share_website: realtor share links
--   work signed out; each checks the link's token itself.
-- - The signed-in functions (mls_readiness, confirm_availability, etc.):
--   each checks the caller's role or builder itself, and signed-out access
--   was already removed.

revoke execute on function public.builder_branding_check_preset() from public, anon, authenticated;
revoke execute on function public.builder_branding_touch() from public, anon, authenticated;
revoke execute on function public.download_presets_one_default() from public, anon, authenticated;
revoke execute on function public.media_tag_requests_prepare() from public, anon, authenticated;
revoke execute on function public.media_tags_prepare() from public, anon, authenticated;
revoke execute on function public.share_links_prepare() from public, anon, authenticated;
