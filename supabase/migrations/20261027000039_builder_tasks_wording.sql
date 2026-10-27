-- The builder's to-do board is now called "Tasks", like our team's board.
do $$ declare d text; begin
  d := pg_get_functiondef('public.builder_tasks_prepare'::regproc);
  if position('New task for you' in d) > 0 then return; end if;
  d := replace(d, 'New to-do for you: ', 'New task for you: ');
  if position('New task for you' in d) = 0 then raise exception 'builder_tasks_prepare: pattern not found'; end if;
  execute d;
end $$;
