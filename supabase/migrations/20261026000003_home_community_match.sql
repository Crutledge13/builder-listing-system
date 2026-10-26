-- A home's community must belong to the same builder as the home, so nobody
-- can attach a home to another builder's community (even by guessing its ID).

create or replace function public.enforce_home_community_match()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.communities c
    where c.id = new.community_id and c.builder_id = new.builder_id
  ) then
    raise exception 'That community belongs to a different builder' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_home_community_match() from public, anon, authenticated;

create trigger homes_community_match
  before insert or update of community_id, builder_id on public.homes
  for each row execute function public.enforce_home_community_match();
