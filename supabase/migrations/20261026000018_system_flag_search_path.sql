-- Pin the search path on the system-update helpers (Supabase security check).
alter function private.system_update_on() set search_path = '';
alter function private.system_update_off() set search_path = '';
