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
| Sales | Builder | Their communities and homes: pricing, availability, status |
| Marketing | Builder | Descriptions, photos and media; no pricing changes |

The permission grid in `docs/` is final once it exists; this table is the starting point.

## Non-negotiable rules

1. **Each builder company is a separate tenant.** Builder A can never see Builder B's data, photos or videos.
2. **Permissions are enforced in the database** with Supabase row-level security (RLS), not just by hiding things on screen. Every new table gets RLS policies in the same change that creates it.
3. **Every field records its source:** website, staff, or MLS.
4. **Imports never silently overwrite staff edits.** New or changed data from builder websites goes to a review queue.
5. **Media is private.** Files live in Cloudflare (R2 for photos, Stream for video), are locked by default, and are viewed through links that expire. Uploads go straight to Cloudflare, not through our server.
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
