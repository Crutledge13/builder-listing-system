-- Fixes from the security review of the inbox, comps, to-do and floor plan work.

-- 1. Comp requests: once made, a request stays on its home and community. Only
--    our team changes anything but the status; requesters can only cancel.
do $$ declare d text; begin
  d := pg_get_functiondef('public.comp_requests_guard'::regproc);
  d := replace(d, $x$  new.builder_id := old.builder_id;
  new.requested_by := old.requested_by;
  if not private.is_staff() and auth.uid() is not null then$x$, $x$  new.builder_id := old.builder_id;
  new.requested_by := old.requested_by;
  new.home_id := old.home_id;
  new.community_id := old.community_id;
  new.requester_name := old.requester_name;
  if not private.is_staff() and auth.uid() is not null then
    -- Everything but the status stays as it was.
    declare st text := new.status; begin
      new := old;
      new.status := st;
    end;$x$);
  if position('Everything but the status' in d) = 0 then raise exception 'comp_requests_guard: pattern not found'; end if;
  execute d;
end $$;

-- 2. Builder to-dos: people can't attach a to-do to an automatic source, and a
--    community must belong to the same builder.
do $$ declare d text; begin
  d := pg_get_functiondef('public.builder_tasks_prepare'::regproc);
  d := replace(d, $x$  if new.home_id is not null and (select builder_id from public.homes where id = new.home_id) is distinct from new.builder_id then$x$,
    $x$  if tg_op = 'INSERT' and new.created_by is not null then
    -- Added by a person (automatic ones are added with no creator): no automatic source.
    new.source_table := null;
    new.source_id := null;
  end if;
  if new.community_id is not null and (select builder_id from public.communities where id = new.community_id) is distinct from new.builder_id then
    raise exception 'That community belongs to another builder';
  end if;
  if new.home_id is not null and (select builder_id from public.homes where id = new.home_id) is distinct from new.builder_id then$x$);
  if position('no automatic source' in d) = 0 then raise exception 'builder_tasks_prepare: pattern not found'; end if;
  execute d;
end $$;
