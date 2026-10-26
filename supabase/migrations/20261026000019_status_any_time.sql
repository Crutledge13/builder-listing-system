-- A home's sale status (available, under contract, sold, paused, off market)
-- can be set any time after it's created, not only once it's live on the MLS
-- (homes often sell before they're listed). MLS tasks still only happen for
-- live listings (homes_tasks checks that).
do $do$
declare src text; pat text;
begin
  src := pg_get_functiondef('public.enforce_home_edit_rules()'::regprocedure);
  pat := $x$    if new.workflow_status <> 'live_on_mls' then
      raise exception 'Only a listing that''s live on the MLS has a market status' using errcode = '23514';
    end if;
$x$;
  if position(pat in src) = 0 then raise exception 'pattern not found'; end if;
  execute replace(src, pat, '');
end $do$;
