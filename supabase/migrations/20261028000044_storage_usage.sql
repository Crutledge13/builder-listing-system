-- Storage meter for Admin: how much file storage the project uses, against
-- the plan's limit (app_settings.storage_limit_mb). The free plan includes
-- 1 GB; change the setting after upgrading (Pro includes 100 GB).

insert into public.app_settings (key, value) values ('storage_limit_mb', '1024')
on conflict (key) do nothing;

create or replace function public.storage_usage()
returns table (bucket text, files bigint, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id::text, count(*), coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  from storage.objects o
  where private.is_staff()
  group by o.bucket_id
  order by 3 desc;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
