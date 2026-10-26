-- Move the "who am I" helper functions out of the public API.
-- RLS policies still use them, but nobody can call them directly over the web.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.my_role() set schema private;
alter function public.my_builder_id() set schema private;
alter function public.is_staff() set schema private;
alter function public.can_see_builder(uuid) set schema private;

-- Function bodies refer to each other by name, so update them.
create or replace function private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select role in ('platform_admin', 'listing_coordinator')
       from public.profiles where id = auth.uid()),
    false)
$$;

create or replace function private.can_see_builder(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_staff() or target = private.my_builder_id() $$;

-- The edit-rules trigger also calls my_role() by name.
do $$
declare src text;
begin
  select pg_get_functiondef('public.enforce_home_edit_rules()'::regprocedure) into src;
  execute replace(src, 'public.my_role()', 'private.my_role()');
end $$;
