# Permission grid

**Status: DRAFT for the owners to approve.** Owners' decision, 28 Oct 2026: marketing is the builder's main operator and can do everything a manager can (approve for the MLS, prices, status, communities, people for sales and marketing, reports); managers keep the same access and mostly follow along and read reports. Written from what the database enforces today (row-level security and triggers in `supabase/migrations/`) and confirmed by role-by-role tests against the test project. Once approved, this grid is final and CLAUDE.md's role table follows it. Any change here must be made in the database rules, `src/lib/permissions.ts` and this file together.

Roles: **Admin** = platform admin, **Coord** = listing coordinator (both our company). **Owner**, **Mgr** = manager, **Sales**, **Mktg** = marketing (builder company). **Photo** = photographer (contractor).

Key: ✅ yes · 👁 view only · ➖ no · "own" = their builder only · "assigned" = only communities they're assigned to · "jobs" = only homes/communities on their open photo jobs

## Builders, communities, people

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See builders | all | all | own | own | own | own | ➖ |
| Add or rename builders | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| See communities | all | all | own | own | assigned | own | ➖ |
| Add communities | ✅ any builder | ➖ | own | own | ➖ | own | ➖ |
| Community setup answers (schools, HOA, showing, directions) | ✅ | 👁 | own | own | ➖ | own | ➖ |
| Edit communities / move to another builder | ✅ | ➖ | own (no move) | own (no move) | ➖ | own (no move) | ➖ |
| See people | all | all | own company | own company | own company | own company | self |
| Add people | ✅ any role | ➖ | own: owner, mgr, sales, mktg | own: sales, mktg | ➖ | own: sales, mktg | ➖ |
| Change roles / turn off access | ✅ | ➖ | own (not self) | own sales, mktg (not self) | ➖ | own sales, mktg (not self) | ➖ |
| Assign salespeople to communities | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Edit own profile, headshot, email, password | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See builder branding (logo, colors, notes) | all | all | own | own | own | own | ➖ |
| Run the setup checklist (skip optional steps, mark setup done) | ✅ any builder | ✅ any builder | own | own | ➖ | own | ➖ |
| Onboarding details (agreement, billing contact, pricing) | ✅ | 👁 | ➖ | ➖ | ➖ | ➖ | ➖ |
| Billing: plans, prices, deal notes, charges, invoices | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Billing: see own plan and prices (no deal notes), sent invoices, charges adding up | ✅ | ➖ | own | ➖ | ➖ | ➖ | ➖ |
| Edit builder branding | ✅ any builder | ➖ | own | own | ➖ | own | ➖ |
| See access history (who gave whom access) | all | all | own | own | ➖ | own | ➖ |

## Homes and listings

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See homes | all | all | own | own | assigned | own | ➖ |
| Add homes (as drafts) | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Edit address, plan, specs, lot, build stage | ✅ | ➖ | ✅ | ✅ | build stage, completion only | ✅ | ➖ |
| Edit price | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Edit description | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Submit for review / back to draft | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Approve for the MLS ("Ready for MLS") | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Mark live with MLS number | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Active / under contract / sold | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Pause / take off market | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Representative-photo disclaimer | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| Move to trash (30 days) | ✅ | ➖ | ✅ | ✅ | ➖ | ✅ | ➖ |
| See MLS sheet details | all | all | 👁 own | 👁 own | ➖ | 👁 own | ➖ |
| Edit MLS sheet details | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Schedule / repeat / cancel open houses | ✅ | ➖ | ✅ | ✅ | assigned | ✅ | ➖ |
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
| Download photos at any size (incl. custom) | all | all | own | own | assigned | own | jobs |
| Add download sizes, set the builder's default size | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Make or turn off realtor share links | ✅ | ➖ | own | own | ➖ | own | ➖ |
| See share links and who opened them | all | all | own | own | ➖ | own | ➖ |
| See photographer pay | all | all | ➖ | ➖ | ➖ | ➖ | their own |
| Approve / mark paid, change rates | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |

## Our team's tools and checks

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| Task board, work sheets, notes | ✅ | ✅ | own MLS work* | own MLS work* | ➖ | own MLS work* | ➖ |
| Mark an approved listing live with its MLS number | ✅ | ✅ | own* | own* | ➖ | own* | ➖ |
| Fill in the MLS sheet (schools, HOA, showing setup) | ✅ | ✅ | own* | own* | ➖ | own* | ➖ |
| Choose who enters a builder's MLS listings | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Website check page | all | all | own | own | ➖ | own | ➖ |
| Turn website feed on/off | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Use website value / add home from website | ✅ | ➖ | own | own | ➖ | own | ➖ |
| See MLS feed data | all | all | own | own | ➖ | own | ➖ |
| Admin area (builders, people, pay, settings) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Email log, system settings | ✅ (settings) / 👁 log | 👁 log | ➖ | ➖ | ➖ | ➖ | ➖ |
| Report an issue / see own reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

\* Only for builders set to enter their own MLS listings (software only). Full-service builders: our team.

## MLS rules, alerts and reports

| Action | Admin | Coord | Owner | Mgr | Sales | Mktg | Photo |
|---|---|---|---|---|---|---|---|
| See MLS boards and their rules | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit MLS rules, fields, counties | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Set a builder's MLS markets | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Change which MLS a home goes to (not once live) | ✅ | ✅ | own | own | ➖ | own | ➖ |
| See readiness check | ✅ | ✅ | own | own | assigned | own | ➖ |
| See alerts | all | all | own (not team-only) | own (not team-only) | assigned (not team-only) | own (not team-only) | ➖ |
| Answer "still available / under contract / sold" | ✅ | ✅ | own | own | assigned | own | ➖ |
| Close alerts by hand, run the compliance check | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Reports page (with filters) | all builders | all builders | own | own | assigned communities | own | ➖ |
| Request comps | ✅ | ➖ | own | own | assigned | own | ➖ |
| See comp requests and delivered comps | all | all | own | own | own requests + assigned | own | ➖ |
| Add comps, deliver files | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Builder Tasks board (start, assign; tasks come only from the system) | 👁 all | 👁 all | own | own | ➖ | own | ➖ |
| Extend a listing that's about to expire (our staff: change the Expire Date on the MLS sheet; builders: "Extend listing" on Tasks) | ✅ | ✅ | own | own | ➖ | own | ➖ |
| Inbox (own notices) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See floor plans and room sizes | all | all | own | own | own | own | ➖ |
| Set up floor plans, upload plan files | ✅ | ✅ | own | own | ➖ | own | ➖ |
| See incentives | all | all | own | own | assigned + builder-wide | own | ➖ |
| Add, extend, reword or end incentives | ✅ | ➖ | own | own | ➖ | own | ➖ |
| Change a home's room sizes | ✅ | ➖ | own | own | ➖ | own | ➖ |

## Outside broker (broker mode)

Built 29 Oct 2026. Brokers have no table access at all; each row below is a `broker_*` database function that first checks the task belongs to a builder in broker mode that added them. For builders set to have their own listing broker enter the MLS (see `docs/build-map.md`, Broker mode). The broker is a separate role with no builder of its own, like a photographer.

| Action | Outside broker |
|---|---|
| See MLS tasks (new listing, update, status change, open house) | only for builders who invited them |
| See work sheet fields, MLS-ready photos, videos, tour links; download the MLS photo pack | those tasks only |
| Tick lines, add notes, enter MLS number and mark live | those tasks only |
| See homes list, communities, media library, reports, website check, share links, activity log, billing, other builders | ➖ |
| Edit any listing details, photos or prices | ➖ |
| Invite or remove a broker | builder owner (own builder) and platform admin |

Builder staff in broker mode don't see the broker's work sheets; they send with "Approve and send to broker" and get a notice and email when each task is done. Billing: the builder pays (owners, 29 Oct 2026).

## Always true

- One builder never sees another builder's homes, people, photos, website or MLS data.
- Turned-off people can't sign in and their role gives no access.
- Nothing is sent to the MLS by the system; our team, the builder, or the builder's broker enters it by hand.
- Nothing is public except realtor share links: one home each, unlisted, never indexed, replaceable or deletable at any time, every view and download logged. Each home's standing link has no end date (owners' decision, 27 Oct 2026); older one-off links still expire.
- Emails are read and marked sent only by our server (service key), never by signed-in users.

## Questions for the owners

1. ~~Should marketing edit specs after adding?~~ Answered 28 Oct 2026: yes, marketing has a manager's access.
2. Should **sales** see the MLS sheet details (schools, HOA) for their communities? Today no.
3. Should the **listing coordinator** be able to fix the builder's fields (e.g. a typo in the address) directly? Today only admins can.
