-- Broker mode, part 1: the new role value. A builder's own listing broker
-- (an outside person, like a photographer: no builder of their own) who enters
-- that builder's listings in the MLS. The value is added in its own file
-- because Postgres won't use a new enum value in the transaction that adds it;
-- everything that uses it is in the next migration.
alter type public.user_role add value if not exists 'broker';
