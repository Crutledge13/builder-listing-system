-- Only our server (with the service key) may read queued emails or mark them
-- sent. Signed-in users could otherwise mark a team email "sent" before it
-- went out.
revoke execute on function public.queued_emails_for(text, uuid) from public, anon, authenticated;
revoke execute on function public.record_email_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.queued_emails_for(text, uuid) to service_role;
grant execute on function public.record_email_result(uuid, text, text) to service_role;
