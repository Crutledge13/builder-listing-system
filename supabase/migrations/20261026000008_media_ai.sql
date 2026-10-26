-- AI room suggestions for media. Rule: every field records its source, so the
-- room says whether AI or a person set it. A person's change always wins.

alter table public.media
  add column room_source text check (room_source in ('ai', 'staff')),
  add column caption_source text check (caption_source in ('ai', 'staff')),
  add column ai_status text check (ai_status in ('pending', 'done', 'skipped', 'failed')),
  add column ai_suggestion jsonb,   -- { room, confidence, tags, caption, flags[] }
  add column ai_at timestamptz;

-- Demo media were labeled by us.
update public.media set room_source = 'staff' where room is not null;

-- When a person changes the room or caption, it's theirs from then on.
create or replace function public.media_track_sources()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.room is not null and new.room_source is null then new.room_source := 'staff'; end if;
    if new.caption is not null and new.caption_source is null then new.caption_source := 'staff'; end if;
    return new;
  end if;
  if new.room is distinct from old.room and new.room_source is not distinct from old.room_source then
    new.room_source := case when new.room is null then null else 'staff' end;
  end if;
  if new.caption is distinct from old.caption and new.caption_source is not distinct from old.caption_source then
    new.caption_source := case when new.caption is null then null else 'staff' end;
  end if;
  return new;
end $$;
revoke execute on function public.media_track_sources() from public, anon, authenticated;
create trigger media_track_sources
  before insert or update on public.media
  for each row execute function public.media_track_sources();
