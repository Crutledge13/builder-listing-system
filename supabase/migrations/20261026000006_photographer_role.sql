-- Photographers: contractors our team assigns to shoot homes. Like our staff,
-- they belong to no builder; they only ever see the jobs assigned to them.
alter type public.user_role add value if not exists 'photographer';

-- (Applied as a separate step: a new enum value can't be used in the same transaction.)
alter table public.profiles drop constraint profile_builder_matches_role;
alter table public.profiles add constraint profile_builder_matches_role check (
  (role in ('platform_admin', 'listing_coordinator', 'photographer') and builder_id is null)
  or (role not in ('platform_admin', 'listing_coordinator', 'photographer') and builder_id is not null)
);
