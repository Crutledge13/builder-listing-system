# Permission grid

**Status: DRAFT for the owners to approve.** Written from what the database enforces today (row-level security and triggers in `supabase/migrations/`) and confirmed by role-by-role tests against the test project. Once approved, this grid is final and CLAUDE.md's role table follows it. Any change here must be made in the database rules, `src/lib/permissions.ts` and this file together.

Roles: **Admin** = platform admin, **Coord** = listing coordinator (both our company). **Owner**, **Mgr** = manager, **Sales**, **Mktg** = marketing (builder company). **Photo** = photographer (contractor).

Key: ✅ yes · 👁 view only · ➖ no · "own" = their builder only · "assigned" = only communities they're assigned to · "jobs" = only homes/communities on their open photo jobs

## Builders, communities, people

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See builders | all | all | own | own | own | own | ➖ |
| Add or rename builders | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| See communities | all | all | own | own | assigned | own | ➖ |
| Add communities | ✅ any builder | ➖ | own | own | ➖ | own | ➖ |
| Edit communities / move to another builder | ✅ | ➖ | own (no move) | own (no move) | ➖ | ➖ | ➖ |
| See people | all | all | own company | own company | own company | own company | self |
| Add people | ✅ any role | ➖ | own: owner, mgr, sales, mktg | own: sales, mktg | ➖ | ➖ | ➖ |
| Change roles / turn off access | ✅ | ➖ | own (not self) | own sales, mktg (not self) | ➖ | ➖ | ➖ |
| Assign salespeople to communities | ✅ | ➖ | own | own | ➖ | ➖ | ➖ |
| Edit own profile, headshot, email, password | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See builder branding (logo, colors, notes) | all | all | own | own | own | own | ➖ |
| Edit builder branding | ✅ any builder | ➖ | own | own | ➖ | own | ➖ |
| See access history (who gave whom access) | all | all | own | own | ➖ | ➖ | ➖ |

## Homes and listings

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See homes | all | all | own | own | assigned | own | ➖ |
| Add homes (as drafts) | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Edit address, plan, specs, lot, build stage | ✅ | ➖ | ✅ | ✅ | build stage, completion only | ➖ | ➖ |
| Edit price | ✅ | ➖ | ✅ | ✅ | ✅ | only when adding | ➖ |
| Edit description | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Submit for review / back to draft | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Approve for the MLS ("Ready for MLS") | ✅ | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Mark live with MLS number | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Active / under contract / sold | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ |
| Pause / take off market | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ |
| Representative-photo disclaimer | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Move to trash (30 days) | ✅ | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ |
| See MLS sheet details | all | all | 👁 own | 👁 own | ➖ | 👁 own | ➖ |
| Edit MLS sheet details | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Schedule / repeat / cancel open houses | ✅ | ➖ | ✅ | ✅ | assigned | ➖ | ➖ |
| Request a change | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Resolve change requests | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Request reverse prospecting | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Deliver reverse prospecting | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Media

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See and download photos/video | all | all | own | own | assigned + builder-wide | own | jobs (existing photos, as reference) |
| Upload | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | jobs |
| Edit tags, room, cover; move to trash | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | only what they uploaded |
| Pick tags from the shared list | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | only what they uploaded |
| Ask for a new tag | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ | ✅ |
| Manage the tag list (add, rename, merge, retire, answer requests) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Request photos (photo requests) | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| See photo requests | all | all | own | own | ➖ | own | their jobs |
| Assign photographer | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Set shoot time, mark delivered | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | their jobs |
| Mark complete / send back | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Set "who photographers call" (shoot contact, access notes) | ✅ | ➖ | own | own | ➖ | own | ➖ |
| See builder name, logo, shoot contact and requester contact on a job | ✅ | ✅ | own | own | ➖ | own | their jobs |
| See photographer pay | all | all | ➖ | ➖ | ➖ | ➖ | their own |
| Approve / mark paid, change rates | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Our team's tools and checks

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| Task board, work sheets, notes | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Website check page | all | all | own | own | ➖ | own | ➖ |
| Turn website feed on/off | ✅ | ➖ | own | own | ➖ | ➖ | ➖ |
| Use website value / add home from website | ✅ | ➖ | own | own | ➖ | own (as draft) | ➖ |
| See MLS feed data | all | all | own | own | ➖ | own | ➖ |
| Admin area (builders, people, pay, settings) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Email log, system settings | ✅ (settings) / 👁 log | 👁 log | ➖ | ➖ | ➖ | ➖ | ➖ |
| Report an issue / see own reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## MLS rules, alerts and reports

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See MLS boards and their rules | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit MLS rules, fields, counties | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Set a builder's MLS markets | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Change which MLS a home goes to (not once live) | ✅ | ✅ | own | own | ➖ | ➖ | ➖ |
| See readiness check | ✅ | ✅ | own | own | assigned | own | ➖ |
| See alerts | all | all | own (not team-only) | own (not team-only) | assigned (not team-only) | own (not team-only) | ➖ |
| Answer "still available / under contract / sold" | ✅ | ✅ | own | own | assigned | ➖ | ➖ |
| Close alerts by hand, run the compliance check | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Reports page | all builders | all builders | own | own | ➖ | ➖ | ➖ |

## Always true

- One builder never sees another builder's homes, people, photos, website or MLS data.
- Turned-off people can't sign in and their role gives no access.
- Nothing is sent to the MLS by the system; our team enters it by hand.
- Emails are read and marked sent only by our server (service key), never by signed-in users.

## Questions for the owners

1. Should **marketing** be able to edit specs (beds, baths, address) on drafts they added? Today only the description after adding.
2. Should **sales** see the MLS sheet details (schools, HOA) for their communities? Today no.
3. Should the **listing coordinator** be able to fix the builder's fields (e.g. a typo in the address) directly? Today only admins can.
