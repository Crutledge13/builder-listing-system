Texas new-construction back office

# Builder Listing Build Map

Every step from idea to working system, and how the tools connect.

**Private system only.** Only your team and your builder clients log in. There is no public website. The MLS is the public outlet. Your team enters listings into it by hand, because the MLS doesn't accept data from outside systems. The MLS can send its data back to you through a read-only feed, which fills in MLS numbers and status and powers the comparison checker.

## How the pieces connect

How it flows: You + Claude Code → GitHub (saves every version) → Vercel (runs staging and live) → Supabase (listings, logins, permission rules) + Cloudflare (photos and videos) → filtered by role → your team and builder teams. Your team enters listings into the MLS by hand. MLS data flows back in through a read-only feed. Builder websites (opt-in) feed listings in.

## The build, A to Z

### Phase 1: Plan on paper (no code)

Most expensive mistakes start here. Cheapest place to fix them.

- List every type of user (see roles below)
- Build the permission grid: each role vs. each action
- Get your MLS's listing input form and list every required field
- Map those fields to the RESO standard so MLS data coming back in lines up with yours
- Get your MLS's photo rules: max count, minimum size, branding limits
- Ask the pilot builder what runs their website, and whether it already sends a listing feed to Zillow or similar sites
- Pick the 5–8 features for version one; park the rest
- Decide how you charge builders (monthly, per listing)
- Ask a Texas real estate attorney who may enter listings into the MLS and under whose license (legal)

### Phase 2: Sketch the screens (no code)

A picture of each view is the clearest instruction you can give the AI.

- Listing entry form that mirrors the MLS fields
- Approval queue: listings waiting for sign-off
- MLS tracker: what's live, pending, or changed
- Comparison checker: website vs. your system vs. MLS, side by side
- Builder dashboard: their homes and status
- Media library: folders, photo grid, search bar, download buttons
- Your admin panel: all builders, users, billing

### Phase 3: Set up your toolbox (1 day)

Every account opened under a company email that you own. See the tool list below.

- GitHub, Supabase (two projects: test and live), Vercel
- Cloudflare account for photo and video storage
- Claude Code
- A domain name for the login address

### Phase 4: Build the foundation

Invisible to users, but everything sits on it. Get it right before features.

- Logins, with nothing visible to anyone signed out
- Builder companies as separate accounts, so data never mixes
- Roles assigned to each user
- Database rules that enforce the permission grid (critical)
- Listing fields stored in MLS/RESO format
- Private photo and video storage, with uploads going straight to Cloudflare
- Every field remembers where its value came from: website, staff, or MLS
- Staging and live versions set up separately
- Backup system running from day one, before any real data (critical)

### Phase 5: Build the features

One feature at a time. Test each before starting the next.

- Add and edit listings: specs, photos, floor plans, pricing, build stage
- Media library: upload, organize, search and download (details below)
- AI photo tagging and quality checks
- Approval step before a listing is "ready for MLS"
- MLS entry sheet laid out in the MLS's field order, for fast manual entry
- MLS tracker: MLS number, status, last change, what needs updating (filled in automatically once the MLS feed is connected)
- Activity log: who changed what and when
- Comparison checker, starting with website vs. your system
- Website import with a "Start MLS listing" button (pilot builder first)
- Dashboards for each role

### Phase 6: Test it hard

Try to break it before a customer does.

- Log in as every role and confirm each sees only what it should
- Confirm Builder A can never see Builder B's data, photos or videos
- Upload a few thousand test photos and a long video; check speed and search
- Delete test data, then restore it from the vault; time how long it takes
- Enter a few test listings into the MLS from the entry sheet; fix anything clumsy
- Pay a developer for a security review (before real data)

### Phase 7: Launch with one builder

A friendly pilot customer tells you what's actually missing.

- Confirm all three backup layers and error alerts are working
- Load the pilot builder's real homes
- Your team enters them into the MLS by hand
- Time how long each listing takes; use it to speed up the entry sheet

### Phase 8: Grow and connect (ongoing)

The repeating loop: feedback, change in staging, test, publish live.

- Add builders and roles as you sign them
- Apply for your MLS's read-only data feed; connect it when approved
- Add the MLS column to the comparison checker once you have MLS data access
- Turn on website feeds for each builder who opts in
- Add billing (Stripe) and HubSpot syncing
- Keep notes on how the system works, so anyone can fix it

## The views (roles)

**Platform admin:** You two. All builders, users, billing, settings.

**Listing coordinator:** Your staff. Enters approved listings into the MLS and logs MLS numbers.

**Builder owner:** Everything for their company, plus adding staff.

**Manager:** Edits listings and approves them for the MLS; no billing.

**Sales:** Their communities and homes: pricing, availability, status.

**Marketing:** Listing descriptions, photos and media; no pricing changes.

Platform admin and listing coordinator are your company's staff. These are starting suggestions; Phase 1's permission grid makes them final.

## Builder website sync

A home on a builder's website isn't always live on the MLS. Two connected features close that gap. Both are designed in from the start; the website feed is an opt-in add-on per builder.

**1. Comparison checker**

- One row per field: website, your system, MLS, side by side
- Mismatches highlighted: price, square feet, beds, baths, status, description
- Flags homes on the website but missing from the MLS, and the reverse
- "Use this value" button to fix a mismatch in one click
- Website column works first; MLS column turns on with MLS data access

**2. Website feed (opt-in)**

- Builder's website listings flow into your system automatically, around the clock
- New and changed homes appear in a review queue, never overwriting staff edits silently
- "Start MLS listing" button prefills every field the website has
- Staff fill only the gaps; missing required MLS fields are highlighted
- Each field shows its source: website, staff, or MLS

**Example view** 1214 Pecan Ridge Dr · sample data

| Field    | Website       | Your system   | MLS                |
|----------|---------------|---------------|--------------------|
| Price    | \$389,990     | \$389,990     | \$399,990          |
| Sq ft    | 2,145         | 2,145         | 2,145              |
| Bedrooms | 4             | 4             | 4                  |
| Baths    | 3             | 3             | 2.5                |
| Status   | Move-in ready | Move-in ready | Under construction |
| Lot size | —             | 0.18 ac       | 0.18 ac            |

Price, baths and status don't match here. Dashes are fields the website doesn't have, which staff fill in.

### How the website connection could work, best option first

**Existing listing feed:** Most reliable — Many builders already send a feed to Zillow or new-home sites. Ask for a copy of the same feed.

**Website platform connection:** Reliable — If their site runs on a platform with an API, connect to it directly.

**Reading the website pages:** Last resort — With the builder's written permission. Breaks when they redesign the site.

**Spreadsheet upload:** Fallback — Works for any builder on day one.

Design rule: build one import door that every source plugs into. Adding a new builder's website then means writing one small connector, not rebuilding the system.

## The media library

Photos and videos are a main feature, not an add-on. Files live in Cloudflare; the database keeps track of where each one is, who owns it, and how it's labeled.

**Organize**

- Builder → Community → Home → Photos / Videos
- Labels: exterior, kitchen, primary bath, drone, floor plan, model home
- Drag to reorder; pick a cover photo
- Attach one model-home photo to many listings without re-uploading

**Search**

- By address, community, plan or lot number
- By room or label: "all kitchens in Oak Creek"
- Filters: photo or video, MLS-ready, date added

**AI helpers (time saver)**

- Auto-labels each photo by room as it uploads
- Flags blurry, dark or duplicate shots
- Flags MLS rule problems: logos, signs, people, text
- Suggests a photo order and drafts captions
- Plain-English search: "twilight exteriors with a pool"

**Download**

- One photo, a selection, or a whole home as a zip
- Choose original or web size
- "MLS photo pack": approved photos, in order, sized to MLS rules
- Downloads follow roles, same as viewing

**Private**

- Nothing public; every file is locked by default
- Each view gets a link that expires after a short time
- Builder A can never open Builder B's files

**Fast at any size**

- Uploads go straight to storage, skipping your app's server
- Big videos upload in pieces and resume if the internet drops
- The grid shows small thumbnails; full size loads only when opened
- Files are served from Cloudflare locations near the viewer

**Rough monthly cost example**

20 builders × 200 homes × 50 photos, plus a 3-minute video per home: about **\$12** for photos (~800 GB) and about **\$60** for video storage, plus a little for video viewing. Prices from Cloudflare's public pricing as of October 2026.

Keep costs down: store each original once, make small viewing copies automatically, and move sold homes to cheaper archive storage.

## The backup system

Three layers, each with a different company, so no single outage, mistake or hacked account can wipe you out. Everything runs automatically.

**Layer 1: Undo to any second**

- Supabase point-in-time recovery (paid add-on)
- Rewind the database to any moment, like "10:42 this morning, before the mistake"
- Fastest fix for everyday accidents

**Layer 2: Off-site vault**

- Every hour: full database copy sent to Backblaze B2, a separate company
- Every new photo and video original copied there within minutes
- Separate login and owner account, locked against deletion
- This is the copy you restore from if Supabase or Cloudflare has a problem

**Layer 3: Readable copy**

- Live Google Sheet: one tab per builder, updated seconds after any change
- Photo mirror in Dropbox: Builder → Community → Home folders
- Your team can open these anytime, with no technical skills
- For browsing and peace of mind; Layers 1 and 2 are for full restores

**Safety rules**

- Deleted listings and photos go to a 30-day trash first
- Activity log records who changed or deleted what
- Alert if any backup fails to run
- Practice a full restore to staging every quarter

The readable copies are deliberately not the main restore path. Spreadsheets and Dropbox slow down at very large sizes and can't hold the database's permission rules; the vault can.

## The toolbox

### Day one

**Code storage:** GitHub — Saves every version, with undo.

**Building:** Claude Code — You describe it; it writes the code into GitHub.

**App framework:** Next.js — The "language" the system is written in. Free; just tell Claude Code to use it.

**Database and logins:** Supabase — Also holds the who-sees-what rules.

**Photo storage:** Cloudflare R2 — Low storage cost and no fees when people view or download.

**Video storage:** Cloudflare Stream — Converts videos to play smoothly on any device. Billed by minutes, not file size.

**Hosting:** Vercel — Runs the system; connects straight to GitHub.

**Staging:** Vercel previews + a second Supabase project — No extra software; test data only.

**Domain name:** Cloudflare or Namecheap

### Keeping it healthy

**Error alerts:** Sentry — Tells you when something breaks, and where.

**Undo to any second:** Supabase point-in-time recovery — Paid add-on. Turn on before launch.

**Off-site vault:** Backblaze B2 — Separate company holding hourly database copies and every photo and video.

**Readable copies:** Google Sheets + Dropbox — Live spreadsheet of all listings and a browsable photo mirror.

### Add as you grow

**System emails:** Resend — Approval alerts, password resets.

**AI photo tagging:** Claude (through the API) — Labels rooms, flags problem photos, drafts captions.

**Billing builders:** Stripe

**CRM:** HubSpot — You already use it; sync builder accounts later.

**Builder website feeds:** Custom connectors — Built by Claude Code, one per website source, all through one import door.

**MLS connection:** Your MLS's read-only data feed — Brings MLS listings and status back in. Requires their approval; most use the RESO Web API.

### Planning

**Screen sketches:** Figma, or Claude mockups

**Permission grid, notes:** Any shared doc or spreadsheet

## Words you'll hear

**GitHub** — Online storage for code that saves every version, so you can undo any change.

**Database** — Where all the information lives: homes, builders, users.

**Hosting** — The service that runs your system on the internet (Vercel here).

**Staging** — A private test copy of the system. Changes go here first.

**Tenant** — One builder company and its walled-off data.

**Roles** — Labels like "Sales" that decide what a user can see and do.

**RLS** — Row-level security: database rules that enforce roles even if a screen has a bug.

**MLS** — Multiple Listing Service: the shared database agents and listing sites pull homes from.

**RESO** — The standard field names and formats MLS systems use. Matching it makes MLS data line up with yours.

**Data feed** — An automatic connection that sends data from one system to another. Here, the MLS sends its listing data to you; nothing is sent to the MLS automatically.

**Sync** — Keeping two systems matched automatically, like a builder's website and yours.

**Connector** — A small piece of code that knows how to read one specific source, like one builder's website.

**Thumbnail** — A small preview copy of a photo, so grids load fast.

**Signed link** — A private file link that stops working after a set time.

**CDN** — A network of servers worldwide that delivers files from the location nearest the viewer.

**API** — A doorway that lets one piece of software use another, like your system asking Claude to label a photo.

**Point-in-time recovery** — Rewinding the database to any exact moment in the past.

**Off-site backup** — A copy kept with a different company, so one provider's problem can't take everything.

**MVP** — Minimum viable product: the smallest version worth launching.
