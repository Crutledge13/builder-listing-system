-- Fix: the "builders can only change status, ticks and who's on it" rule on our
-- MLS tasks also caught the system itself. Example: a builder extends a listing
-- or edits a live home, and the database adds that change to the open MLS
-- update. The rule now runs as the caller (security invoker), so it only
-- applies to changes a person makes directly; the system's own functions run
-- as their owner and pass.
create or replace function public.tasks_builder_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'authenticated' or auth.uid() is null or private.is_staff() then return new; end if;
  if (to_jsonb(new) - array['status', 'checked', 'assignee_id', 'updated_at', 'completed_at', 'completed_by'])
     is distinct from (to_jsonb(old) - array['status', 'checked', 'assignee_id', 'updated_at', 'completed_at', 'completed_by']) then
    raise exception 'You can change the status, the ticks and who''s on it' using errcode = '42501';
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id and p.is_active and p.builder_id = new.builder_id
      and p.role in ('builder_owner', 'manager', 'marketing')) then
    raise exception 'Assign it to an owner, manager or marketing person at your company';
  end if;
  return new;
end $$;
