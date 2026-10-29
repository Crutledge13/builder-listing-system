-- Demo: the sales "MLS entry" switch (TEST project only).
-- Taylor Brooks (Mesquite Creek, Oak Creek): MLS entry on, marketing approves.
-- Dana Fields (Redbud Ridge): MLS entry on, no approval needed (straight to our team).
-- Jamie Ortiz and Sam Whitfield stay standard salespeople.
update public.profiles set sales_mls_entry = true, sales_needs_approval = true
 where email = 'sales.mesquite@demo.test';
update public.profiles set sales_mls_entry = true, sales_needs_approval = false
 where email = 'sales.redbud@demo.test';
