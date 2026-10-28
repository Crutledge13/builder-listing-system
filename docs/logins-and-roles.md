# Logins, links and roles

How to sign in to each copy of the system, which account to use for each role, and what each role does. Written 28 Oct 2026. Passwords are never written here; they live in the owners' password manager.

## The copies of the system

| Copy | Link | Database | Data | Status |
|---|---|---|---|---|
| **Test / demo** | https://builder-listing-system.vercel.app | Supabase `builder-listing-test` | Fake only | Running today. Demo mode on ("View as…" menu). |
| **Previews** | A new link for each GitHub branch, shown on the branch in GitHub and in Vercel | Same test database | Fake only | Automatic. Use to try an idea before it reaches the test site. |
| **Live** | Planned: app.yourdomain.com | Supabase live project (not created yet) | Real | Not built. See "Before real data" below. |
| **Demo for prospects** | Planned: demo.yourdomain.com | Its own database, resets nightly | Fake only | Not built. Today the test site doubles as the demo. |

How a change travels: Claude Code writes it on a branch in GitHub → Vercel makes a preview link → you check it → it's merged into `main` → the test site updates → (once Live exists) it's promoted to Live.

## Test accounts (test site only)

All test accounts share one password, kept in the password manager as **"Builder Listings — demo password"**. Signed in as any of them, the **View as…** menu at the top switches between them without signing out.

| Sign in as | Role | Company | Sees |
|---|---|---|---|
| admin@demo.test | Platform admin | Our team | Everything, every builder, all settings |
| coordinator@demo.test | Listing coordinator | Our team | MLS work for the builders it's given |
| photographer@demo.test | Photographer | Contractor | Only its assigned jobs |
| owner.mesquite@demo.test | Builder owner | Mesquite Creek Homes (demo) | All of Mesquite Creek |
| manager.mesquite@demo.test | Manager | Mesquite Creek Homes (demo) | All of Mesquite Creek, no billing |
| marketing.mesquite@demo.test | Marketing | Mesquite Creek Homes (demo) | Homes, photos, descriptions; no price changes |
| sales.mesquite@demo.test | Sales | Mesquite Creek Homes (demo) | Only assigned communities |
| sales2.mesquite@demo.test | Sales | Mesquite Creek Homes (demo) | Only assigned communities (a different set) |
| owner.prairie@demo.test | Builder owner | Prairie Lantern Builders (demo) | All of Prairie Lantern |
| marketing.prairie@demo.test | Marketing | Prairie Lantern Builders (demo) | Prairie Lantern homes and media |

Two builders exist on purpose: signed in as a Mesquite Creek user, nothing from Prairie Lantern should ever appear, and the reverse.

On Live there will be no shared logins and no "View as…" menu. Each person gets their own invite (Admin → People) and sets their own password.

## What each role does

### Platform admin (the owners)
Controls everything. Start at **Admin**.
- **Admin → Builders**: add a builder, its MLS markets, who enters the MLS (our team or the builder), the website feed, and the **feature switches** (turn comps, reverse prospecting, website check, reports or the builder task board on or off for one builder).
- **Admin → People**: invite people, set their role and company, assign salespeople to communities, turn someone off (they can't sign in, history stays). Every access change is logged here.
- **Admin → Communities, MLS rules, Photo tags, Photographer pay, Settings** (team email and phone, the log of emails the system would have sent).
- The **builder picker** in the top bar narrows every screen to one builder. It's only a view filter.

### Listing coordinator (our team)
Turns approved homes into MLS listings, by hand.
- **Tasks**: the team board. New listings, MLS updates, status changes and open houses appear on their own.
- Open a task → the **work sheet**: every NTREIS field in Matrix order with copy buttons, photos in MLS order, **Download MLS photo pack**, and the **MLS number → mark live** box.
- **Compliance** and **Website check** for mismatches and deadlines.

### Photographer (contractor)
- **Jobs**: each assigned shoot with address, directions, who to call and access notes. Set the shoot time, upload photos and video (separate boxes), add tour links, **Mark delivered**. Sees existing photos of that home for reference, nothing else.
- **Earnings**: what each completed job pays (tracking only; no money moves).

### Builder owner
Everything for their company. **Communities** is the start page. Plus **Team** (add and change their staff), **Branding** (logo, colors, download sizes), **Tasks** (their to-do board), **Reports**.

### Manager
Same as the owner without billing. Edits listings and approves homes for the MLS (**Approvals**). Adds sales and marketing staff.

### Marketing
Adds homes (as drafts) and communities, writes descriptions, uploads and organizes media, requests photo shoots (**Photo requests**). Can't change prices after a home is added.

### Sales
Only their assigned communities: price, availability, status, open houses, change requests, and viewing and downloading media. Can copy a home's **Share link** to send a realtor. Can't add homes, upload media or request photos.

## How the pieces connect

- **GitHub** (`Crutledge13/builder-listing-system`) holds the code and every database change. It's the source of truth.
- **Vercel** runs the site from GitHub: `main` → the test site; every other branch → a preview link.
- **Supabase** holds the data, the logins and the who-sees-what rules. The rules are enforced in the database, so a screen bug can't show the wrong builder's data.
- **Photos and videos** are in private Supabase storage during testing; they move to Cloudflare (R2 photos, Stream video) before launch.
- **Claude API** labels photos and reads floor plans and brand guides, once its key is set in Vercel.
- **Emails**: the system writes every email it means to send to a log (Admin → Settings). Nothing is sent until Resend is connected. Supabase's own login emails (invites, password resets) do send.
- **MLS**: our team types listings in by hand. Later, the MLS's read-only feed fills in MLS numbers and status. Nothing is ever sent to the MLS.
- **Builder websites**: today the website check uses sample rows. A real builder's website needs its own small connector.
- **Backups**: three layers (Supabase rewind, hourly Backblaze vault, Google Sheet + Dropbox), described in `docs/backups.md`. Built, not yet switched on.

## Trying it out (test site)

1. **Photographer shoot, start to finish.** As marketing.mesquite, open a home → request photos. As admin, assign photographer@demo.test and a shoot time. As the photographer, open **Jobs**, upload photos and a short video, mark delivered. As marketing, review and mark complete. Check the photos landed on the home's listing in order and the MLS photo pack downloads.
2. **Walls between builders.** As owner.prairie, search for any Mesquite Creek address or photo. Nothing should come up.
3. **Sales limits.** As sales.mesquite, confirm only assigned communities show and there's no upload or Add a home.
4. **Home to MLS.** As marketing, add a home; as manager, approve it; as coordinator, work the new task and mark it live with a made-up MLS number.
5. **Turn a feature off.** As admin, switch off comps for Mesquite Creek; as owner.mesquite, confirm Request comps is gone.

Use your own photos (your house, your office) for upload tests, not a builder's, until Live exists.

## Before real data (from `CLAUDE.md` and `docs/backups.md`)

- Make the GitHub repository **private**.
- Create the live Supabase project (Pro plan), apply the database changes, turn on point-in-time recovery and leaked-password protection.
- Database warnings: fixed 28 Oct 2026 (`20261028000043_lock_trigger_functions.sql`). The warnings Supabase still shows are intended: share-link functions that must work signed out, and signed-in functions that check the caller themselves.
- Switch on the backups and pass one restore drill.
- Paid security review.
- Set up Live in Vercel with its own settings and a real domain; no demo password there.
