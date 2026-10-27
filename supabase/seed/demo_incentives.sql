-- Demo incentives (TEST project only): one builder-wide, one per community for
-- a couple of communities, one on a single home, and one ending in 5 days so
-- the "ending soon" to-do shows up when the daily check runs.
insert into public.incentives (builder_id, title, details, ends_on)
select b.id, 'Rate buydown to 4.99%', 'With our preferred lender on homes that close by the end date.', private.today_central() + 60
from public.builders b where b.name like '%(demo)%';

insert into public.incentives (builder_id, community_id, title, details, ends_on)
select c.builder_id, c.id, '$10,000 toward closing costs', 'On contracts written by the end date.', private.today_central() + case when row_number() over (order by c.name) = 1 then 5 else 45 end
from public.communities c join public.builders b on b.id = c.builder_id
where b.name like '%(demo)%'
order by c.name limit 2;

insert into public.incentives (home_id, builder_id, title, details, ends_on)
select h.id, h.builder_id, 'Free blinds and fridge', 'Move-in ready special.', private.today_central() + 30
from public.homes h where h.deleted_at is null and h.build_stage = 'move_in_ready' order by h.unparsed_address limit 1;

select private.run_incentive_checks();
