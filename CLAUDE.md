# Builder Listing System

Private back-office system for new-construction home builders in Texas. This file is the source of truth for project rules; `docs/` holds the detailed plans. If anything elsewhere disagrees, this repository wins.

## What this is

- A private system where listing data, photos and videos are created, organized and approved.
- Only our staff and our builder clients log in. Nothing is visible to anyone signed out.
- **Never public-facing.** No consumer website, no public listing pages, no home-buyer accounts, no SEO or public search. The MLS is the public outlet.
  - **One approved exception (owners, 27 Oct 2026): realtor share links.** Each home has one standing, unlisted link anyone at the builder who can see the home (salespeople included) can copy and send, so a realtor can download its photos and videos and click through to the builder's website. These pages are never indexed, never listed anywhere, show only that one home, can be replaced or deleted at any time, and log every view and download. The standing link has no end date (owners' decision, 27 Oct 2026); older one-off links made for a named realtor still expire. Nothing else may be public.

## The MLS

- Our team enters approved listings into the MLS **by hand**. The MLS does not accept data from us. Never build anything that sends data to the MLS.
- The MLS can send data **to** us through a read-only feed (usually the RESO Web API). We use it for MLS numbers, status tracking and the comparison checker.
- Store listing fields in RESO standard names and formats so MLS data lines up with ours.

## Roles

| Role | Who | Can do |
|---|---|---|
| Platform admin | Our company | All builders, users, billing, settings |
| Listing coordinator | Our company | Enters approved listings into the MLS, logs MLS numbers |
| Builder owner | Builder | Everything for their company, plus adding staff |
| Manager | Builder | Same access as marketing; in practice follows along and reads the reports. No billing |
| Sales | Builder | Only their assigned communities: pricing, availability, status, open houses, change requests, view and download media. Cannot add homes, upload media or request photos. |
| Marketing | Builder | The builder's main operator (owners' decision, 28 Oct 2026): everything a manager can do. Adds and edits homes (specs, price, room sizes, NTREIS answers), approves them for the MLS, changes listing status, runs open houses, communities and their setup, photos and media, the setup checklist, reports, and adds/changes sales and marketing users. No billing |
| Photographer | Contractor (no builder) | Only their assigned jobs: set a shoot time, upload and tag media for that home or community, mark delivered. Sees the existing photos of the home or community on an open job (reference shots for reshoots), and nothing else: no other homes, prices, listing details or other builders' media. |

The full permission grid is `docs/permission-grid.md` (draft until the owners approve it; then it is final and this table follows it).

## Non-negotiable rules

1. **Each builder company is a separate tenant.** Builder A can never see Builder B's data, photos or videos.
2. **Permissions are enforced in the database** with Supabase row-level security (RLS), not just by hiding things on screen. Every new table gets RLS policies in the same change that creates it. Every new `public` trigger function gets `revoke execute ... from public, anon, authenticated` in the same change (triggers still fire); every new callable `security definer` function checks the caller itself and revokes `anon` unless it's a share-link function. Yes/no permission helpers (`private.can_*`) always return true or false, never null (wrap them in `coalesce(..., false)`): people with no builder (photographers) or who were just turned off would otherwise slip past a check written as `if not private.can_...`.
3. **Every field records its source:** website, staff, or MLS.
4. **Imports never silently overwrite staff edits.** New or changed data from builder websites goes to a review queue.
5. **Media is private.** Files are locked by default and viewed only through links that expire. Uploads go straight from the browser to storage, not through our server. Target home is Cloudflare (R2 for photos, Stream for video); for the test phase, uploads use a private Supabase Storage bucket (`media`). Storage calls live in `src/app/api/media/[id]/route.ts` and `src/app/(app)/media/upload/`, so moving to Cloudflare before launch is contained.
6. **Deletes go to a 30-day trash first**, and every change is written to the activity log.
7. **No real builder data** goes into the system until backups and a security review are done. Until then, use realistic fake data only.
8. **One template for every builder.** All builders share one codebase, one database and one deployment. Never copy the code or make a separate deployment for a builder, and never write code that checks which builder it is (no builder names, IDs or slugs in code or migrations; demo builders belong only in `supabase/seed/`). When one builder needs something different, make it a setting or feature switch any builder could use (see "Builder settings and feature switches"), with a default that keeps every other builder as it is.

## Tech stack

- Next.js (app framework), hosted on Vercel
- Supabase: database, logins, RLS. Separate test and live projects.
- Cloudflare R2 (photos) and Cloudflare Stream (video)
- Sentry for error alerts
- Claude API: photo labeling (Haiku 5.5), floor plan and brand guide reading (Sonnet 5.5), paid from per-builder AI credits
- Later: Resend (email), Stripe (billing), HubSpot sync

## Working style

- The owners understand tech but are not developers. Explain changes in plain language and recommend one option rather than listing many.
- Build one feature at a time and test it before starting the next.
- Builder website imports all go through one shared import door; each source is a small connector.

## Current stage

Demo build with fake data: a thin, real version of the app (logins, two fake builders, six roles, RLS) to work out problems and to show marketing managers. First screens: media library, listing form, approval queue.

## How the code is laid out

- `supabase/migrations/` — every database change, in order. The database's security rules live here. Never change the database by hand without adding a migration file. Each file's leading number is unique and the files sort in the order they were applied; a new enum value is added in an earlier file than the one that first uses it (Postgres won't use a new value in the same transaction).
- `scripts/db-replay/` — the practice run: builds a brand-new Postgres 17 from `supabase/migrations/` and loads the demo seed (`cd scripts/db-replay && npm install && node replay.mjs ../..`, as a normal user, not root). It runs on GitHub for every change to `supabase/` (`.github/workflows/db-replay.yml`); a failure there means the live project couldn't be built from the repo.
- `src/lib/safe-path.ts` — `safePath()`: the only check for "send them back to this page" addresses (form `back` fields, `next=`, notification links). It refuses anything that could lead off the site, including `/\evil.com`.
- `supabase/seed/demo_data.sql` — fake builders, homes and `@demo.test` logins for the TEST project only. The demo password is not in the repo. Then, in order: `demo_media.sql`, `demo_photo_requests.sql`, `demo_round3.sql`, `demo_mls.sql`, `demo_plans.sql`, `demo_incentives.sql`, `demo_tasks.sql`.
- `src/proxy.ts` — sends anyone signed out to `/login`.
- `src/lib/permissions.ts` — what each role sees on screen. Mirrors the database rules; the database is the real enforcement.
- `src/app/(app)/` — the signed-in screens: communities (start page, add a community) and each community's homes, all homes, home detail (edit, approvals, listing status, open houses incl. repeating, reverse prospecting, photo requests, change requests), add a home, approvals, media library, photo requests, photographer jobs and earnings, tasks (our team), team (builder owners/managers), website check, help, setup checklist (`/setup`), community setup (`communities/[id]/setup`), admin.
- `src/lib/menu.ts` — which tabs show on top for each role and the builder's feature switches (owners, managers and marketing get Tasks, their builder board; builders who enter their own MLS also get MLS work); everything else is in the menu. Request comps is a tile in each home's row of quick links and a button on each community, plus Comps in the menu.
- `src/components/home-art.tsx`, `src/components/media-art.tsx` — drawn pictures (exteriors, rooms, floor plans, community scenes) for demo media. `demo-media/videos/` holds four short demo videos.
- `src/app/(app)/media/` — media library (builder > community > home folders, room/type/tag filters, search), item page (download, tags, cover, trash), upload.
- `src/app/api/media/[id]/route.ts` — the only way files are served: reads the media record as the signed-in user (RLS decides), then redirects to an hour-long storage link or streams a demo video.
- `src/app/(app)/admin/` — platform admins only: overview, onboarding (add a builder, invite the owner, agreement and billing details), builders, communities (assign to a builder), people (roles, sales community assignments, invites), change-request inbox.
- Next.js 16: middleware is called `proxy`, and Cache Components is on, so pages that read the signed-in user wrap that part in `<Suspense>`. Read `node_modules/next/dist/docs/` before using unfamiliar Next.js APIs.

## Environments

| | Supabase project | Notes |
|---|---|---|
| Test | `builder-listing-test` (ref `fautaulhpsmeqnlzyhdc`, us-east-2) | Fake data only. Demo mode on. |
| Live | not created yet | Create only after backups are in place. |

Environment variables are listed in `.env.example`. Set them in Vercel; never commit `.env.local`. The test project's public Supabase address and key are built in as fallbacks (`src/lib/supabase/config.ts`); the live deployment must set its own.

## Demo mode

When `DEMO_PASSWORD` is set (and `DEMO_MODE` isn't `false`), anyone signed in as a `@demo.test` user gets "See the demo as someone else…" in the menu to switch between demo users and show each role's view. The admin login (`admin@demo.test`, Conner Rutledge, `DEMO_ADMIN` in `src/lib/auth.ts`) sees everything; while viewing as anyone else, the demo banner at the top has a one-click "Back to Conner Rutledge (admin)". Never set `DEMO_PASSWORD` on the live system.

## Sales access

Salespeople see only the communities they're assigned to (`community_assignments`), enforced by RLS through `private.can_see_home`. Owners and managers see their whole builder. Assign salespeople in Admin > People, or from a community page (owners and managers).

## Photo requests and photographers

`media_requests`: the builder team (not sales) asks for photos/video/drone/floor plan on a home or a whole community; our admins assign a photographer and shoot time; the photographer uploads and marks it delivered; the builder marks it complete or sends it back. Status rules live in the `media_requests_guard` trigger. Each request copies the address, community and builder name so photographers never need access to `homes`. Photographers can add media only to homes/communities on their open jobs (`private.photographer_can_shoot`) and edit only what they uploaded. Screens: `/media/requests` (builders, admins), `/jobs` (photographers), and the Photo requests section on each home. Each job card shows the builder's name and logo, a Directions button (Google Maps, Apple Maps, copy address) and who to call: the builder's shoot contact and access notes (`builder_photo_info`, set by owners, managers and marketing under "Who photographers call" on `/media/requests`), the person who requested it, and our team (`app_settings.team_email`, `team_phone`). Photographers get these only through `public.my_job_info()` for their own jobs, and see a builder's logo only while they have a job for that builder (`private.photographer_sees_logo`, `public.job_logo_path`). The job upload page has separate Photos and Video boxes and a back button.

## Design

White canvas, Figtree type, "bluebonnet" blue (#3452c7) as the single accent. Image-first cards like the big listing sites. Keep new screens consistent with `src/components/home-card.tsx` and the home detail page.

## Media

**Photo speed rules (keep these on every new screen):** grids, cards and folder covers use `MediaPicture` (default `size="thumb"`), never the original file; a photo's own page uses `size="web"`; only downloads and the MLS photo pack fetch the original. Pictures load lazily as they scroll into view. Lists that can grow (media results, folders) are paged, and counts come from the database (`community_media_counts`, `home_media_counts`), never by loading every row. Uploads make the preview copies in the browser (`src/lib/previews.ts`): `thumb_path` (~640 px WebP, or a video's still frame) and `web_path` (~1600 px WebP), saved next to the original with `.thumb.webp` / `.web.webp`; if the browser can't read a file the original is used. `/api/media/[id]?size=thumb|web` serves them, falling back to the original, and lets the browser reuse the link for 50 minutes. AI labeling reads `web_path` when there is one. Realtor share pages use the same copies through `/s/[token]/file/[id]?size=…` (`share_file` returns the preview paths; `share_access.file_is_shared` accepts them).

`media` rows belong to a builder, optionally a community, optionally a home (a home's builder and community are filled in automatically). Each has a room label and tags; the address, plan, community and room are added as tags automatically, and `search_text` powers search. Who sees media follows homes: staff all, builders their own, sales only their communities (plus builder-wide items). Owners, managers, marketing and our admins upload and edit. Nothing is hard-deleted; `deleted_at` is the trash.

## Listing photos, video and tours (what goes on the MLS)

`listing_media` is each home's MLS list, in order: photos, floor plans, video and virtual tours. It fills itself: anything uploaded to the home (our photographer's deliveries or the builder's own uploads) goes on the end (`media_to_listing`, `tours_to_listing`); trashing an item takes it off every listing. Community items (amenity, entrance, aerial, community video) and the floor plan library's photos are optional: the builder adds them on the home page (`listing_media_prepare` only accepts the home's own, its community's or its plan's items, same builder). Removing from the listing never deletes the file. `virtual_tours` holds tour links (Matterport, Zillow 3D Home, iGUIDE, Cupix, YouTube, Vimeo, other) for a home or a whole community, marked branded or unbranded, with who added them (`added_by_role`: photographer / builder / staff); photographers add them for their open jobs on the job upload page. Same RLS as media: owners, managers, marketing and our admins change listings; sales view. Screens: "Listing photos, video and tours" on each home (with "Download all N photos (.zip)" at a picked size and a link to every file; the "Download media" tile at the top of the home jumps here; `src/components/listing-media-panel.tsx`, actions in `homes/[id]/listing-actions.ts`), the last step of Add a home (our photographer → a photo request; our own → straight to upload; add the community's photos; tour links). Our team's MLS sheet and work sheets show MLS-ready photos in listing order, video downloads and tour links, with a "Download MLS photo pack" zip built in the browser (`photo-pack-button.tsx`, files 01-exterior.jpg, ... plus README with tour links; built client-side because Vercel caps server responses at ~4.5 MB). Readiness counts photos on the listing. On live listings, listing changes go on the MLS update task (`listing_media_changes`: photos added/removed, video, tours, photo order); the old `media_mls_changes` trigger is gone.

## Photo tags (one shared list)

Extra tags come only from `media_tags` (label, group: shot / inside / outside / community, other names, active). `media_prepare` maps whatever is sent to the list label (by name or other name, ignoring case) and drops anything not on the list; automatic tags (address, plan, community, room) are added as before, and a room that's also on the list uses the list's name. Retired tags can't be picked but stay on photos that have them. Admins manage the list at Admin > Photo tags: add, rename (`rename_media_tag`, every photo updates, old name kept as another name), merge (`merge_media_tags`) and retire. Anyone who tags photos (not sales) can ask for a new tag from a photo's page (`media_tag_requests`); admins add it, point to an existing tag (`approve_media_tag_request`) or decline. Screens use `TagPicker` (`src/components/tag-picker.tsx`): pick from the list, no free typing. The AI gets the list in its prompt and its tags are matched to it (`matchToList` in `src/lib/tags.ts`).

## AI photo labeling

After an upload, `src/lib/ai-tagging.ts` sends each JPG/PNG/WebP photo (by a 10-minute private link) to Claude Haiku 5.5 (`claude-haiku-5-5`), which suggests the room, up to 6 tags, a short caption and MLS warnings (blurry, dark, people, signs/logos, text). It runs after the response via `after()`, with the uploader's own database access. AI fills only what a person hasn't set; `room_source` / `caption_source` say `ai` or `staff`, and a person's edit flips them to `staff` (trigger `media_track_sources`). Flagged photos are not marked MLS-ready. HEIC photos skip AI. Each photo uses 1 AI credit (see "AI credits"); when the builder is out, the photo is saved with `ai_status = 'no_credits'` and AI skips the rest of that batch. Needs `ANTHROPIC_API_KEY` in Vercel.

## AI credits

Every AI call is paid for from the builder's monthly AI credits (migration `20261028000045_ai_credits`, `src/lib/ai-credits.ts`). Costs are in `app_settings.ai_credit_costs`: photo label 1 credit (Haiku 5.5, about $0.0003 to us), floor plan read 25 and brand guide read 25 (Sonnet 5.5, about $0.02-0.04). Each builder gets `app_settings.ai_credits_default` (2,500) a month unless `ai_allowances` gives them their own (0 turns AI off for them); `ai_credit_grants` adds extra for one month. Months run on Central time and reset on the 1st. Code calls `spendCredits` (`public.ai_spend`, which reserves the credits or returns null when there aren't enough, one spender per builder at a time) before the AI call, and `finishCredits` (`public.ai_finish`) after it with the real tokens, or to give the credits back when the call failed. Runs by our staff and photographers are logged with `counts = false` and never use a builder's credits. `ai_usage` keeps every call with tokens and dollar cost (from `app_settings.ai_prices`; update it if Anthropic's prices change); only those two functions write it; staff see all, builder owners and managers their own. Screens: `AiCreditMeter` (`src/components/ai-credit-meter.tsx`) on Floor plans, each plan's file section and the upload page for builder users; Admin overview "AI credits this month" (`public.ai_usage_summary`) shows credits used, photo and plan counts and real cost per builder, with per-builder monthly credits, extra credits for this month and the default.

## Admin and invites

Inviting people needs `SUPABASE_SERVICE_ROLE_KEY` set in Vercel (server only, never in code or the browser). Without it the invite form is off; everything else in Admin works.

**Invite links (no email needed).** Adding a person (Admin > Onboarding's owner, Admin > People, a builder's Team page) makes their login with `auth.admin.generateLink` and sends no email (`src/lib/invite-links.ts`); the login is marked `user_metadata.needs_password`. Whoever added them clicks "Get invite link" next to their name (`InviteLink`, `src/components/invite-link.tsx`, action `getInviteLink` in `src/app/(app)/invite-actions.ts`) and sends the link any way they like. The link is our own `/auth/confirm?token_hash=…&type=invite` (or `magiclink` once opened), which signs them in and sends them to `/welcome`: they confirm their name and choose a password (10+ characters), then go straight to their setup checklist (or the start page). Until they choose one, `src/proxy.ts` sends every page to `/welcome`. Links work once and expire after Supabase's email link lifetime (Auth settings, about an hour by default); "Make a new link" works any time, but only for people who haven't set a password yet, so a link can never be used to get into an active account. Who can make one: our admins for anyone; owners, managers and marketing for the people they can manage. Expired links land on the login page with an explanation.

**Storage meter:** the Admin overview shows file storage used per bucket (`public.storage_usage()`, staff only) against `app_settings.storage_limit_mb` (set in Admin > Settings in GB: 1 on Supabase's free plan, 100 on Pro), and warns at 80%. Uploads that fail say why (`src/lib/upload-errors.ts`); when some files in a batch fail, the upload page stays put and lists them to retry.

## Our team's task board

`tasks` (staff only) is our to-do list at `/tasks`. Database triggers add tasks on their own: approved homes (enter in MLS), edits to live listings (update MLS), listing status changes, open houses (add/remove on MLS), change requests, photo requests, reverse prospecting, and help reports. Finishing the source (e.g. delivering a reverse prospecting list) closes its task. `task_notes` holds comments.

## MLS work (our team)

Builders give the basics; our team enters listings into the MLS from a staff-only **MLS sheet** (`/homes/[id]/mls`). `src/lib/mls-fields.ts` lists every MLS field in NTREIS input order with RESO names and where each value comes from: the home (builder's data), `mls_details` for this home (our team), `mls_details` for the community (shared defaults like schools, HOA, utilities, showing contact), or derived. Builders can read `mls_details` but only staff write it.

Each task opens a **work sheet** at `/tasks/[id]`: new listings show the full sheet with copy buttons, a check-off per line, photos in MLS order and an "MLS number → mark live" box; updates show only what changed (`tasks.changes`: field, what the MLS has now, what to change it to, plus photos added/removed, recorded by `private.note_mls_change` and the `media_mls_changes` trigger); status changes show the new MLS status and the contract date or close date and price (`homes.purchase_contract_date`, `close_date`, `close_price`); open house tasks list each date. Ticked lines are saved in `tasks.checked`.

## NTREIS questions for builders

The full NTREIS Matrix Residential form (every tab, field, required flag and pick-list, read from a blank form on 26 Oct 2026) is `docs/ntreis-residential-fields.md`. `src/lib/ntreis-fields.ts` is that form as code, in Matrix's order with Matrix's exact labels and spellings; it drives both "Add a home" and our team's MLS sheet for NTREIS homes (`baseSections('NTREIS')`). Add a home is step by step like Matrix's tabs (`src/components/form-steps.tsx`): one step per section, a step bar showing what NTREIS still needs on each, Back/Next, Save draft on every step and a Review step; all steps stay in one form, so nothing is lost moving between them, and NTREIS-only steps drop out for homes going to another MLS. Fields marked `ask` are asked of the builder, each with short `help` text; `source: "builder"` answers are stored in `homes.mls_fields` (keyed by RESO name, per-answer sources in `field_sources` as `mls_fields.<key>`). Owners, managers, marketing and our admins can change them after a home is added (`enforce_home_edit_rules`). Our team's own entry in `mls_details` wins over the builder's answer on the sheet. Many NTREIS boxes are filled automatically (`derive`): street number/name/type from the address, construction status from build stage, lot size unit and range, garage and covered spaces, MUD/PID Yes/No from the community's MUD or PID answer, Owner Name, Special Listing Conditions (Builder). `mls_readiness` warns with any missing builder answers listed in `mls_boards.rules.builder_required` (a warning, not a block). Live listings: changed answers go on the MLS update task (`homes_mls_fields_changes`). If NTREIS changes its form, update the doc and `ntreis-fields.ts` together, and the NTREIS row's `builder_required` / `builder_labels`.

## MLS per home and the readiness check

`mls_boards` holds each MLS (NTREIS, HAR, Unlock MLS, SABOR): counties covered, rules (`status_change_hours`, `new_listing_hours`, `min_photos`, `min_photo_long_edge`, `remarks_max_chars`, `verified`, `source`), per-field overrides (`field_rules`: required/hidden/label by RESO name) and `extra_fields`. Only NTREIS's rules are confirmed (72-hour status changes and input, no contact info in public remarks, no compensation in any field, photo content rules, sold price required); the others are starting values marked unconfirmed. Admins edit them in Admin > MLS rules.

Builders list their markets in `builder_settings.mls_boards` (Admin > Builders, set at onboarding); `mls_locked` locks every home to a single market. Communities and homes get `mls_board` from `private.suggest_mls_board` (builder's market covering the county), with an override for owners, managers and our team; a live listing can't move to another MLS. `sectionsForBoard()` in `src/lib/mls-fields.ts` builds each MLS's field list for the MLS sheet and work sheets.

`public.mls_readiness(home)` returns block / warn / team items: the MLS's required builder fields, photo count and size (plan photos count when the disclaimer is on), description rules (phone, email, web address, compensation, length), and uncleared AI photo warnings. The `homes_mls_ready_guard` trigger refuses "Ready for MLS" while anything blocks. The checklist shows on the home and in the approvals queue; "I checked it: OK for the MLS" on a photo clears its AI warning.

## Alerts, stage triggers and MLS compliance

`home_alerts` (one open alert per home and kind; audience builder, team or both). `private.run_listing_checks()` runs hourly (pg_cron `listing-checks`) and on demand ("Run the check now" on `/compliance`): completion date passed, weekly "still available?" for live listings, builder website showing under contract/sold, MLS feed status mismatch, status changes past half or all of the MLS window, open houses within 24 hours not entered, live descriptions breaking rules, long pending. Alerts resolve themselves when fixed; builder alerts email the owner, managers and assigned salespeople; urgent team alerts email the team.

Builders answer from "Needs your attention" (a collapsed panel showing the 6 most pressing on the communities and reports pages, the full list at `/attention`, also in the menu) or the home: Still available / Under contract (date) / Sold (date and close price), via `public.confirm_availability`. "Still available" also closes a "website shows under contract/sold" alert and records that website status as wrong (`website_listings.status_confirmed_text`), so the check only raises it again if the website status changes. Marking a live home sold or under contract creates a high-priority task due in a third of the MLS window, with the MLS deadline, and emails our team at once.

Stage triggers: a home going move-in ready automatically requests real photos; when they're delivered the representative disclaimer comes off (`media_requests_real_photos`, using the `app.system_update` flag that lets trusted database code bypass role edit rules). Stage changes on live homes already add an MLS update.

## Inbox and deliveries

`notifications` is each person's inbox (bell in the header, `/inbox`; `private.notify`, `private.notify_builder`). Finished work comes back to whoever asked: a delivered reverse prospecting list or comp report notifies and emails the requester (`private.queue_email_to`). Files delivered back are `deliverable_files` (private bucket `deliverables`, 50 MB, served by `/api/deliverables/[id]`); who sees a file follows who can see its request (`private.request_visible`, runs with the caller's own access). Our team uploads them; the "Send to {requester}" button delivers.

## Comp requests

"Request comps" (owners, managers, marketing, sales; a tile on each home next to Open houses and Reverse prospecting, a button on each community) opens `/comps/new`: the home or an address, community, price point, square feet, beds, baths, stories, radius, sold within, what kind (sold, active, pending), notes. `comp_requests` RLS: our team all; owners, managers and marketing their builder's; sales their own requests and their assigned communities. Each request adds a 'comps' task to our board and emails our team. Our team pulls comps and adds them on `/comps/[id]` (`comp_request_items`, staff write only) plus any files, then delivers; the requester gets a notice and email. Everything stays on the request for later.

## Builder to-do board

`builder_tasks` is each builder's own task board at `/todo`, shown as "Tasks" (a top tab for owners, managers and marketing; our staff see every board read-only as "Builders' tasks"). It holds only work that comes from the system; nobody types in their own tasks (no insert policy; `builder_tasks_people_guard` refuses inserts and any change except start/stop, reassign, and "Let it expire"; `private.add_builder_task` / `close_builder_tasks` raise `app.builder_tasks_system` so the system can). Each kind opens and closes itself: listing expiring (MLS Expire Date in `mls_details`, 14 days out, daily `listing-expiry-checks`; owners, managers and marketing "Extend listing" via `public.extend_listing`, which saves the new date and puts it on the MLS update, or "Let it expire"), incentive ending, photos to review, change request, and three our team is working on that the builder is waiting for (media ordered, reverse prospecting, comps: "Waiting on our team", closed when delivered or cancelled). Laid out like our team's board: Open / Assigned to me / Done, kind chips with counts, grouped Overdue / Due today / This week / Later / No due date, two-column cards with Start and an assignee picker.

## Floor plans and room sizes

`floor_plans` (one per builder plan: specs, NTREIS Levels, # living and dining areas, and a room list) is set up at `/plans` by our team or by the builder's owners, managers and marketing for their own builder (same people as `private.can_edit_branding`; `canEditPlans` in `permissions.ts`); everyone at the builder reads their own. Builders upload plan files into their own folder of `plan-files`, and each read uses 25 AI credits. A plan file (PDF or image, private bucket `plan-files`, `/api/plan-file/[id]`) is read by Claude Sonnet 5.5 (`src/lib/plan-scan.ts`, needs `ANTHROPIC_API_KEY`); what it reads waits as `scan` until someone clicks "Use these rooms" or dismisses it. Rooms are RESO rows (RoomType from NTREIS's list, RoomLevel 1-9 or B, RoomLength, RoomWidth in feet), cleaned by `private.clean_rooms` on plans and on homes. A home's rooms live in `homes.mls_fields -> 'Rooms'`: "Room sizes" on each home (fill from the plan, then adjust; owners, managers, marketing and our admins edit, like other NTREIS answers), the Rooms step of Add a home (`RoomsEditor`, filled by "start from a floor plan" or a copied listing), and a Room sizes list with copy buttons on our MLS sheet and work sheets. "Start from a floor plan" uses the plans our team set up first, then the latest home on a plan. NTREIS homes with no rooms get a readiness warning (`rooms`).

## Builder settings and feature switches

Everything that differs between builders lives in the database, set per builder:

- `builder_settings` (Admin > Builders, platform admins): MLS markets (`mls_boards`, `mls_locked`), who enters the MLS (`mls_entry`), website feed, and `features_off`.
- `builder_branding` (`/branding`): logo, colors, fonts, website, tagline, brand notes, default download size.
- `builder_photo_info`: who photographers call and access notes.
- Community-level `mls_details`: shared MLS answers for every home in a community.
- Default title company (`builder_settings.title_company_*`: name, office location, phone, escrow officer and email; migration `20261028000048_default_title_company`).

**Feature switches:** `builder_settings.features_off` lists the optional features a builder doesn't have; empty means everything is on, so new features are on for everyone unless turned off. Today's switches: comp requests, reverse prospecting, website check, reports, the builder's Tasks board. The list is `FEATURES` in `src/lib/features.ts` and the check on the `features_off` column; add a key to both (new migration) to make another feature switchable. Only platform admins change it (`builder_settings_mls_entry_guard`, which also guards `mls_entry`, `mls_boards` and `mls_locked`; builder owners, managers and marketing can still save their website feed settings). Screens use `featuresOff()` / `hasFeature()` to hide tabs, menu links and buttons, and `requireFeature()` at the top of a feature's pages. Comp and reverse prospecting requests are also refused in the database when off (`feature_request_guard`, via `private.builder_feature_on`), since they create work for our team. Our staff always see every feature for every builder.

When a builder asks for something different, first check whether an existing setting covers it; if not, add a setting or switch with a default that leaves other builders unchanged, and list it here.

## Builders who enter their own MLS listings (software only)

`builder_settings.mls_entry` is `our_team` (full service, the default) or `builder` (they buy the software and enter listings in the MLS themselves). Only our platform admins set it, in Admin > Builders (`builder_settings_mls_entry_guard`). When it's `builder`, that builder's owners, managers and marketing get the MLS work our team would get (`private.can_work_mls`, `private.is_mls_task`: new listings, updates, status changes, open houses): an "MLS work" tab (`/tasks`, limited by RLS to their own MLS tasks) with the same work sheets (`/tasks/[id]`, copy buttons, ticks, notes, "MLS number → mark live"), the MLS sheet (`/homes/[id]/mls`, they can fill in `mls_details`), and they can move approved homes to live with the MLS number (`enforce_home_edit_rules`). Each new MLS task sends them a notice and an email (`tasks_builder_notice`; status changes email with the MLS deadline from `homes_status_urgency`). Alerts that were team-only (feed mismatches, deadlines, rule breaks) go to them instead (`raise_alert`), and our team isn't emailed about them. On our task board those tasks show "Builder enters this". The builder can only change a task's status, ticks and who's on it (`tasks_builder_guard`). Photo shoots, comps and reverse prospecting stay with our team.

## Incentives

`incentives` (builder-wide, one community, or one home; title, details, a required end date; status active / ended / expired). Owners, managers, marketing and our admins add, extend, reword and end them at `/incentives` (links from each home and community; RLS via `private.on_builder_board`); everyone else who can see the homes sees them (sales: their communities plus builder-wide). Agent compensation is refused (`incentives_prepare`, same rule as the MLS remarks check). They show on the home page (its own, its community's and builder-wide, via `public.home_incentives`), the community page, a line on home cards, realtor share pages (`share_page` returns `incentives`) and our MLS sheet and work sheets (copy for the remarks). Daily pg_cron `incentive-checks` (`private.run_incentive_checks`, 7 am Central): 7 days before the end date it adds an 'incentive' to-do on the builder's board (urgent within 2 days), notifies and emails marketing; past the end date it expires on its own and tells owners, managers and marketing. Extending or ending closes the to-do. Adding, rewording, extending, ending or expiring puts an "Incentive: …" line on the MLS update task of every live home it covers (`incentives_after`, via `private.note_mls_change`); home-level ones also go in the home's activity log.

## Reports

`/reports` (our team, builder owners, managers and marketing, and salespeople for only their assigned communities; sales don't see the website section): listing health per builder for a period (last 30/90 days, a month, a year, or custom dates; `parseRange` in `src/lib/report.ts`): homes live, days on market, price changes, under contract or sold, website homes not on the MLS, homes sitting too long, compliance issues caught. A community picker narrows the whole report. Each list (`FilterTable`, `src/components/filter-table.tsx`) has its own search, community/plan/status filters and sorting, shows 10 homes and folds the rest; printing shows everything that matches. Download as Excel (`/reports/export`, built with exceljs from the same `buildReport`) or print to PDF. Approval-to-live time is tracked (`homes.approved_at`, `live_at`) but not shown to builders.

## Add a home: required answers and starting points

On the step-by-step Add a home form, required questions show a pill instead of a red star ("Required" = needed to save the draft, "MLS required" = the MLS needs it before going live) and stay shaded in our blue until answered (`FormSteps` sets `data-empty`; styles in `globals.css`). "Save time: start from something" (`src/components/start-from.tsx`, under the community) fills every step at once from a floor plan (specs and layout answers from the latest home on that plan), a copy of an existing listing (everything except address, lot, parcel, legal description and lockbox), or a website home not yet added (`website_listings` with no `home_id`). Filled answers show green with "Filled from …"; anything the person typed or ticked is never replaced. On save, values still matching the website listing are marked source `website` (checked on the server) and the website listing is linked to the new home.

## Download sizes, builder focus and reels

Downloads (photo page, "Download all photos" on a home's media folder, our team's MLS photo pack) let people pick a size: built-in sizes in `download_presets` (full quality original, MLS 2048 px JPG, website 1920 px WebP, social 1080 px, email 1024 px), the builder's own sizes, or a custom size typed in. Owners, managers and marketing add sizes and pick the builder's default on `/branding` (`builder_branding.default_download_preset`); each person's last pick is remembered in their browser. Resizing happens in the browser (`src/lib/image-resize.ts`, `DownloadMenu`, `PhotoPackButton`), never on our server; pictures are never enlarged, and "Full quality" hands over the untouched original. The MLS photo pack always uses the MLS size.

Our team can narrow every page to one builder with the picker in the top bar (`builder_focus` cookie, `src/lib/builder-focus.ts`): tasks (plus general tasks), communities, homes, media, approvals, compliance, photo requests, and the starting builder on website check and reports. It's only a view filter; the database still decides access.

Photo requests can ask for a horizontal walkthrough video (`video`) and a vertical social reel (`vertical_video`, 9:16); video uploads have a "Vertical social reel" type (tagged "Vertical reel"), picked automatically when the video is taller than wide.

## Realtor share links

`share_links` (one home; random 32-character `token`; `expires_at`, null for the home's standing link; `revoked_at`; `deleted_at` = trash; view and download counts) and `share_link_events` (each view and download). Each home has one standing link (`expires_at` null, at most one live per home: `share_links_one_standing`), made the first time anyone opens the home by `public.home_share_link(home)`, which returns it to anyone who can see the home: owners, managers, marketing, salespeople for their communities, our staff. Everyone copies it with the "Share link" button in the row of buttons at the top of each home (`ShareLinkTile`, `src/components/share-link-tile.tsx`; one click copies, shows "Link copied"). Owners, managers, marketing and our admins also get the "Share with a realtor" section further down (`src/components/share-links-panel.tsx`, `homes/[id]/share-actions.ts`): see what the realtor sees, open/download counts, "Replace link" (trashes the current one, makes a new one), and where the "More info" button goes (website page link or suggested match). Older one-off links (a named realtor, an end date) are listed under it for them to delete (Undo right after) or extend; no new ones are made. Buttons use `PendingButton` so a slow save can't make duplicates. The token, home and counts can't be changed by people (`share_links_prepare`); making, turning off, deleting and restoring links goes in the home's activity log. The public page is `/s/[token]` (`src/app/s/`, allowed signed out in `src/proxy.ts`): builder logo, the home's facts and description, a "More info on {builder}'s website" button (`public.share_website`, in order: the linked website listing's `url`, the home's `website_page_url`, `builder_branding.website_url`; hidden when there's none), listing photos (gallery with per-photo size picker and a zip), horizontal walkthrough and vertical reel videos, tour links. It reads only through `public.share_page(token)`; files come through `/s/[token]/file/[id]` (`public.share_file`, which checks the file belongs to that home and logs downloads) as hour-long storage links, and the logo through `/s/[token]/logo`. Signed-out visitors may only create storage links for files of homes with a live share link (`share_access.file_is_shared`, its own schema). Pages send `noindex` and `no-referrer` (`next.config.ts` and page metadata). What a link shows: what's on the home's listing (`listing_media`), plus the home's own videos; homes with no listing order yet show their own photos.

## A home's page on the builder's website

Each home can be tied to its own page on the builder's website (for the share page's "More info" button and the website check). Never by guessing: builders with their website connected (`builder_settings.website_feed_enabled`) get it when a home is added from its website listing, or when someone confirms a suggested match. `public.website_link_suggestions(home?)` lists website listings and homes at the same builder with the same address (`private.address_key`: case, punctuation and street words like Drive/Dr ignored; ZIP must agree when both have one), neither linked; people confirm with "Yes, link them" on the home or "Link them" on Website check > New on website (`linkWebsiteListing`, `linkWebsiteMatch`, which only accept a pair the database suggests). Builders without a connected website paste it: `homes.website_page_url` (optional, full http(s) address, `src/lib/website-page.ts`), asked on the last step of Add a home (shown when the builder's feed is off; always for our staff) and editable in "Share with a realtor" on the home by owners, managers, marketing and our admins (`enforce_home_edit_rules`).

## Buyer's agent on a contract

Marking a home under contract (the Home status panel, or "Under contract" in Needs your attention) asks for the buyer's agent: name and brokerage (required), MLS ID and TREC license (if known), an optional second agent, or "The buyer has no agent" (`BuyerAgentFields`, `src/lib/buyer-agent.ts`). Stored on `homes` with RESO names (`buyer_agent_full_name`, `buyer_office_name`, `buyer_agent_mls_id`, `buyer_agent_state_license`, `co_buyer_agent_full_name`, `co_buyer_office_name`, `buyer_unrepresented`). `enforce_home_edit_rules` refuses under contract without them, treats them as sale details (anyone who can mark under contract can set them), and clears them when a contract falls through (back to active). `confirm_availability` takes them as `p_buyer`. The "Change to Pending" task lists each one for our team. Only what the MLS needs; no phone or email.

## Listing status and open houses

`homes.market_status` (active, paused, under_contract, sold, withdrawn) can be set any time after a home is created (the "Home status" panel on each home, next to construction stage: To be built / Under construction / Completed); MLS tasks and deadlines only apply once it's live. Pausing, going under contract, selling or withdrawing ends repeating open houses, cancels future ones, and adds a task to update the MLS. Repeating open houses (`open_house_series`) create dates only as far ahead as the MLS allows (`app_settings.mls_open_house_window_days`, default 28); a daily pg_cron job adds the next dates and a task for each batch.

## Plan photos and the disclaimer

Media with `plan_name` and no home or community is the floor plan library (model home photos). Home pages fill in from it when a home has fewer than 5 photos, and the home media page shows three sections: this home, its community, its plan. `homes.show_representative_disclaimer` puts a "representative" strip on the home's photos and on downloads.

## Website check

`builder_settings` turns a builder's website feed on (owners/managers). `website_listings` are homes as the website shows them; `mls_listings` come from the MLS's read-only feed (never written by us). `/website-check` compares website, Builder Listings and MLS on price, beds, baths and square feet (not descriptions). "Use website value" copies one field over (marked source `website`); homes only on the website can be added as a draft or "pushed live" (added and approved, so our team enters them into the MLS). In the demo both feeds are fake rows in `supabase/seed/demo_round3.sql`.

## Emails

`email_outbox` logs every email the system means to send (reverse prospecting, help reports) to `app_settings.team_email`. `src/lib/email.ts` sends them through Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise they're marked not sent and visible in Admin > Settings. Reading and marking queued emails (`queued_emails_for`, `record_email_result`) is server-only: it needs `SUPABASE_SERVICE_ROLE_KEY`; signed-in users can't call them.

## Photographer pay (demo)

`photographer_rates` is the rate card; when a builder marks a photo request complete, `photographer_payments` gets a row priced from it. Admins approve and mark paid (Admin > Photographer pay); photographers see Earnings on `/jobs`. No money moves.

## My profile and builder branding

`/account` (everyone, from the name at the top of the menu): name, job title, phone (`public.update_my_profile`, which can't change role, company or access), headshot (private bucket `profile-photos`, folder = the person's id, `public.set_my_avatar`), sign-in email (Supabase sends a confirmation link to `/auth/confirm`; `private.sync_profile_email` copies the confirmed email to `profiles`), and password (checks the current one first, 10+ characters). Shared `@demo.test` logins can't change email or password while demo mode is on. Headshots are served by `/api/avatar/[id]`; `Avatar` in `src/components/avatar.tsx` falls back to initials.

`/branding` (owners, managers, marketing for their builder; our admins for any; everyone else at the builder and our coordinators can view): logo (private bucket `branding`, folder = builder id), any number of named colors (`colors` jsonb, first is the main one; `primary_color`/`secondary_color` are kept in step by the `builder_branding_touch` trigger), fonts, website, tagline and brand notes for our team, in `builder_branding` (`private.can_edit_branding`). A brand guide (PDF or image, up to 25 MB, same bucket, downloaded via `/api/brand-guide/[builderId]`) is read by Claude Sonnet 5.5 right after upload (`src/lib/brand-scan.ts`, needs `ANTHROPIC_API_KEY`); what it finds is saved as `brand_guide_scan` and only added when someone ticks the parts they want and clicks "Add to branding" (colors and fonts are added, website and tagline replace only if ticked, notes are appended). The logo isn't pulled from the guide. The logo is served by `/api/logo/[builderId]` and shows in the header for builder users, on community cards, on Reports and in Admin > Builders (`BuilderLogo`). Confirmation emails use Supabase's built-in sender until Resend is connected as Supabase's SMTP; Supabase's Site URL and redirect URLs must include the app's address.

## Onboarding a builder

Three layers, each asking only for what the next step needs:

1. **Before the invite (our team, Admin > Onboarding, `/admin/onboarding`).** "Add a builder" lives here (Admin > Builders links to it): display name, legal company name (`builders.legal_name`, fills the MLS Owner Name; falls back to the display name), MLS markets, their default title company, the owner's name and email (invited straight away when `SUPABASE_SERVICE_ROLE_KEY` is set), and the details in `builder_onboarding`: agreement and listing-authorization dates, what we charge, billing contact, what runs their website, whether they already send a listing feed, notes. Each builder's card shows its stage, their checklist progress, what's "waiting on us", an owner invite form if there's no owner, and the details form. `builder_onboarding` is staff-read, admin-write (managers have no billing access); a row is made for every builder by `builders_add_onboarding`.
2. **The builder's setup checklist (`/setup`).** Owners, managers and marketing see it; a "Setup" top tab and a banner on the communities page show while it's open (`setupOpen`, `SetupBanner`), and "Setup checklist" stays in the menu. Our staff open any builder's with `/setup?builder=` ("Builder setup" in the menu). Steps are worked out from real data in `src/lib/onboarding.ts` (`loadOnboarding`), so they tick themselves off: team, logo, brand guide, website, who photographers call, default title company, communities, each community's setup, salespeople on communities, floor plans, first home, first approval. The only stored choices are optional steps skipped (team, brand guide, website, title company) and "We're all set" (`builder_onboarding.skipped`, `finished_at`), read and changed only through `public.builder_setup_state`, `set_setup_skip` and `finish_setup` (staff, or that builder's owner, a manager or marketing). Stages for Admin: Getting ready → Invited → Setting up → First community ready → First listing approved → Live on the MLS.
3. **Community setup (`/communities/[id]/setup`).** The MLS questions shared by every home in a community (schools, HOA, MUD/PID, utilities, lockbox, showing setup, directions), for that community's MLS (`communitySections`), with a "ready for the MLS" meter (`communityCompleteness`) and builder-friendly help. Answers live in `communities.mls_fields` (sources in `field_sources`, set by `communities_mls_fields_sources`); owners, managers, marketing and our admins edit (the community rules), coordinators view. Adding a community sends them straight here. On the MLS sheet a community field uses our team's `mls_details` entry if there is one, else the builder's answer (`mergeCommunityDetails`); saving the sheet doesn't store a value that matches the builder's answer, so it keeps following the builder. A changed answer goes on the MLS update task of every live home in the community (`community.<Key>`, `communities_mls_fields_changes`) unless our team has its own entry for that field.

## Default title company

Most builders close through one title company. It's set once per builder in `builder_settings` (`title_company_name`, `_location`, `_phone`, plus `_contact` and `_email` for the escrow officer, which only our team and the builder see): at onboarding (Admin > Onboarding, both forms), on `/branding#title-company` ("Default title company", owners, managers, marketing and our admins; `TitleCompanyFields`, `saveTitleCompany`), and as an optional setup checklist step. It fills NTREIS's Title Company Preferred / Location / Phone (`TitleCompanyPreferred`, `TitleCompanyLocation`, `TitleCompanyPhone`, community fields in the Financial section) through `titleDefaults()`: our team's entry wins, then the community's own answer (community setup, for a community that uses a different one), then the builder default (`mergeCommunityDetails(answers, staff, defaults)`). Changing the default puts the change on the MLS update task of every live home that uses it (`builder_settings_title_changes`); community answers that change what a live home uses do the same (`communities_mls_fields_changes`).

## Builder teams

Builder owners add/change anyone at their company; managers and marketing add and change sales and marketing users and put salespeople on communities (`private.can_manage_person`, `community_assignments` rules). Turning someone off sets `profiles.is_active = false`: their history stays and they can't sign in (role helpers return nothing for inactive people).

## Activity log

Home, photo and MLS-sheet changes are logged per home. Access changes are logged too (`profiles_log_access`, `community_assignments_log` triggers): people added, role or company changes, access turned off/on, salespeople added to or removed from communities. Builder owners, managers and marketing see their company's access history (Team page); our staff see all (Admin > People). Sales don't see access history.

## Backups and error alerts

Three backup layers, set up per `docs/backups.md`: Supabase point-in-time recovery (live project, paid), hourly encrypted copy of the database and photo originals to Backblaze B2 (`.github/workflows/backup-hourly.yml`, `scripts/backup/`), and readable copies in Google Sheets and Dropbox. A restore drill (`restore-drill.yml`) runs quarterly. Nothing runs on the schedule until the GitHub variable `BACKUPS_ENABLED` is `true`. Sentry (`@sentry/nextjs`, `sentry.*.config.ts`, `src/instrumentation*.ts`) reports errors once `NEXT_PUBLIC_SENTRY_DSN` is set; it never sends user info, cookies, headers, form contents or query strings.

## Known follow-ups

- Turn on leaked-password protection in Supabase Auth before the live project goes out.
- Move media storage to Cloudflare R2/Stream before launch, and add a 30-day job that purges trashed files.
- Whole-home zip download (the MLS photo pack zip exists). Previews exist for new uploads; uploads made before `20261027000035_media_previews` have none and show the original until re-uploaded or backfilled.
- When moving to Cloudflare, video stills can come from Cloudflare Stream instead of the browser; keep `thumb_path` as the column the app reads.
- Email or text notifications (new photo request, photographer assigned, delivered) once Resend is set up. Reverse prospecting and help emails are already wired (they log until Resend is set).
- Real website feed and MLS read-only feed connectors (through the shared import door); the demo uses seeded rows.
- Real photographer payouts (e.g. Stripe Connect); today it's tracking only.
- Field-level edit rules for homes are enforced by the `enforce_home_edit_rules` trigger; update it alongside `src/lib/permissions.ts` when the permission grid changes.
