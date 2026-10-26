# Builder Listing System

Private back-office system for new-construction home builders in Texas. This file is the source of truth for project rules; `docs/` holds the detailed plans. If anything elsewhere disagrees, this repository wins.

## What this is

- A private system where listing data, photos and videos are created, organized and approved.
- Only our staff and our builder clients log in. Nothing is visible to anyone signed out.
- **Never public-facing.** No consumer website, no public listing pages, no home-buyer accounts, no SEO or public search. The MLS is the public outlet.

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
| Manager | Builder | Edits listings, approves them for the MLS; no billing |
| Sales | Builder | Only their assigned communities: pricing, availability, status, open houses, change requests, view and download media. Cannot add homes or upload media. |
| Marketing | Builder | Descriptions, photos and media; no pricing changes |
| Photographer | Contractor (no builder) | Only their assigned jobs: set a shoot time, upload and tag media for that home or community, mark delivered. Sees no homes, prices, builders or other media. |

The permission grid in `docs/` is final once it exists; this table is the starting point.

## Non-negotiable rules

1. **Each builder company is a separate tenant.** Builder A can never see Builder B's data, photos or videos.
2. **Permissions are enforced in the database** with Supabase row-level security (RLS), not just by hiding things on screen. Every new table gets RLS policies in the same change that creates it.
3. **Every field records its source:** website, staff, or MLS.
4. **Imports never silently overwrite staff edits.** New or changed data from builder websites goes to a review queue.
5. **Media is private.** Files are locked by default and viewed only through links that expire. Uploads go straight from the browser to storage, not through our server. Target home is Cloudflare (R2 for photos, Stream for video); for the test phase, uploads use a private Supabase Storage bucket (`media`). Storage calls live in `src/app/api/media/[id]/route.ts` and `src/app/(app)/media/upload/`, so moving to Cloudflare before launch is contained.
6. **Deletes go to a 30-day trash first**, and every change is written to the activity log.
7. **No real builder data** goes into the system until backups and a security review are done. Until then, use realistic fake data only.

## Tech stack

- Next.js (app framework), hosted on Vercel
- Supabase: database, logins, RLS. Separate test and live projects.
- Cloudflare R2 (photos) and Cloudflare Stream (video)
- Sentry for error alerts
- Later: Resend (email), Stripe (billing), HubSpot sync, Claude API for photo tagging

## Working style

- The owners understand tech but are not developers. Explain changes in plain language and recommend one option rather than listing many.
- Build one feature at a time and test it before starting the next.
- Builder website imports all go through one shared import door; each source is a small connector.

## Current stage

Demo build with fake data: a thin, real version of the app (logins, two fake builders, six roles, RLS) to work out problems and to show marketing managers. First screens: media library, listing form, approval queue.

## How the code is laid out

- `supabase/migrations/` — every database change, in order. The database's security rules live here. Never change the database by hand without adding a migration file.
- `supabase/seed/demo_data.sql` — fake builders, homes and `@demo.test` logins for the TEST project only. The demo password is not in the repo.
- `src/proxy.ts` — sends anyone signed out to `/login`.
- `src/lib/permissions.ts` — what each role sees on screen. Mirrors the database rules; the database is the real enforcement.
- `src/app/(app)/` — the signed-in screens: communities (start page) and each community's homes, all homes, home detail (edit, approvals, open houses, photo requests, change requests), add a home, approvals, media library, photo requests, photographer jobs, admin.
- `src/components/home-art.tsx`, `src/components/media-art.tsx` — drawn pictures (exteriors, rooms, floor plans, community scenes) for demo media. `demo-media/videos/` holds four short demo videos.
- `src/app/(app)/media/` — media library (builder > community > home folders, room/type/tag filters, search), item page (download, tags, cover, trash), upload.
- `src/app/api/media/[id]/route.ts` — the only way files are served: reads the media record as the signed-in user (RLS decides), then redirects to an hour-long storage link or streams a demo video.
- `src/app/(app)/admin/` — platform admins only: overview, builders, communities (assign to a builder), people (roles, sales community assignments, invites), change-request inbox.
- Next.js 16: middleware is called `proxy`, and Cache Components is on, so pages that read the signed-in user wrap that part in `<Suspense>`. Read `node_modules/next/dist/docs/` before using unfamiliar Next.js APIs.

## Environments

| | Supabase project | Notes |
|---|---|---|
| Test | `builder-listing-test` (ref `fautaulhpsmeqnlzyhdc`, us-east-2) | Fake data only. Demo mode on. |
| Live | not created yet | Create only after backups are in place. |

Environment variables are listed in `.env.example`. Set them in Vercel; never commit `.env.local`. The test project's public Supabase address and key are built in as fallbacks (`src/lib/supabase/config.ts`); the live deployment must set its own.

## Demo mode

When `DEMO_PASSWORD` is set (and `DEMO_MODE` isn't `false`), anyone signed in as a `@demo.test` user gets a "View as…" menu to switch between demo users and show each role's view. Never set `DEMO_PASSWORD` on the live system.

## Sales access

Salespeople see only the communities they're assigned to (`community_assignments`), enforced by RLS through `private.can_see_home`. Owners and managers see their whole builder. Assign salespeople in Admin > People, or from a community page (owners and managers).

## Photo requests and photographers

`media_requests`: the builder team asks for photos/video/drone/floor plan on a home or a whole community; our admins assign a photographer and shoot time; the photographer uploads and marks it delivered; the builder marks it complete or sends it back. Status rules live in the `media_requests_guard` trigger. Each request copies the address, community and builder name so photographers never need access to `homes`. Photographers can add media only to homes/communities on their open jobs (`private.photographer_can_shoot`) and edit only what they uploaded. Screens: `/media/requests` (builders, admins), `/jobs` (photographers), and the Photo requests section on each home.

## Design

White canvas, Figtree type, "bluebonnet" blue (#3452c7) as the single accent. Image-first cards like the big listing sites. Keep new screens consistent with `src/components/home-card.tsx` and the home detail page.

## Media

`media` rows belong to a builder, optionally a community, optionally a home (a home's builder and community are filled in automatically). Each has a room label and tags; the address, plan, community and room are added as tags automatically, and `search_text` powers search. Who sees media follows homes: staff all, builders their own, sales only their communities (plus builder-wide items). Owners, managers, marketing and our admins upload and edit. Nothing is hard-deleted; `deleted_at` is the trash.

## Admin and invites

Inviting people needs `SUPABASE_SERVICE_ROLE_KEY` set in Vercel (server only, never in code or the browser). Without it the invite form is off; everything else in Admin works.

## Known follow-ups

- Turn on leaked-password protection in Supabase Auth before the live project goes out.
- Move media storage to Cloudflare R2/Stream before launch, and add a 30-day job that purges trashed files.
- Thumbnails and web-size copies of uploads; whole-home zip and MLS photo pack downloads.
- AI photo tagging (Claude API) to suggest rooms and tags on upload.
- Approved open houses should show in the listing coordinator's queue for MLS entry.
- Email or text notifications (new photo request, photographer assigned, delivered) once Resend is set up.
- Field-level edit rules for homes are enforced by the `enforce_home_edit_rules` trigger; update it alongside `src/lib/permissions.ts` when the permission grid changes.
