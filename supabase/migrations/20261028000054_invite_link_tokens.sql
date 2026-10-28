-- Our own invite links (28 Oct 2026).
--
-- Supabase's one-time sign-in links were being used up by email security
-- scanners (Outlook / Microsoft Safe Links open every link to check it), so
-- the person's own click then said "expired or already used". Supabase's
-- links also can't last longer than a day. So an invite link is now our own
-- token: /accept/<token> shows a page with a Continue button, and only that
-- button (which scanners don't press) signs the person in. A link works for
-- 48 hours, can be opened any number of times until the person sets their
-- password, and is replaced when a new one is made.
--
-- Only our server (admin key) reads or writes this table; platform admins can
-- see it for troubleshooting.

create table public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(token) >= 32),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,          -- the person set their password
  revoked_at timestamptz,       -- replaced by a newer link
  created_at timestamptz not null default now()
);
create index invite_tokens_profile_idx on public.invite_tokens (profile_id);
alter table public.invite_tokens enable row level security;
revoke all on public.invite_tokens from anon, authenticated;
grant select on public.invite_tokens to authenticated;
create policy "admins see invite links" on public.invite_tokens
  for select to authenticated using (coalesce(private.my_role() = 'platform_admin', false));
