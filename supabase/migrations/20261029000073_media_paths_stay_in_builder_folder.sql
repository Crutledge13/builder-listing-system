-- Review fix (29 Oct 2026): a media record's file paths must point inside its
-- own builder's storage folder ("<builder id>/..."), and people can't repoint
-- them after upload. Before this, someone who can edit a media record could
-- point it at another builder's file name and then fetch that file through
-- their own record (the storage rule only asks "can you see a record with this
-- path?"). Every upload already uses that folder (media/upload, plan photos),
-- so nothing legitimate changes. Trusted database code (no signed-in person)
-- may still move files, e.g. the move to Cloudflare.
create or replace function public.media_paths_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare folder text := new.builder_id::text || '/';
begin
  if (new.storage_path is not null and left(new.storage_path, length(folder)) <> folder)
     or (new.thumb_path is not null and left(new.thumb_path, length(folder)) <> folder)
     or (new.web_path is not null and left(new.web_path, length(folder)) <> folder)
     or coalesce(new.storage_path || new.thumb_path || new.web_path, '') like '%..%' then
    raise exception 'Files must be in this builder''s own folder' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null
     and (new.storage_path is distinct from old.storage_path or new.thumb_path is distinct from old.thumb_path
          or new.web_path is distinct from old.web_path or new.builder_id is distinct from old.builder_id) then
    raise exception 'Upload a new file instead of changing where this one points' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.media_paths_guard() from public, anon, authenticated;
create trigger media_paths_guard before insert or update on public.media
  for each row execute function public.media_paths_guard();
