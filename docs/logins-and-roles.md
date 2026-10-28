# Logins, links and roles

How to sign in to each copy of the system, which account to use for each role, what each role does, and how to bring on a new builder. Updated 28 Oct 2026. Passwords are never written here; they live in the owners' password manager.

## The copies of the system

| Copy | Link | Database | Data | Status |
|---|---|---|---|---|
| **Test / demo** | https://builder-listing-system.vercel.app | Supabase `builder-listing-test` | Fake only | Running today. Demo mode on. |
| **Previews** | A new link for each GitHub branch, shown on the branch in GitHub and in Vercel | Same test database | Fake only | Automatic. Use to try an idea before it reaches the test site. |
| **Live** | Planned: app.yourdomain.com | Supabase live project (not created yet) | Real | Not built. See "Before real data" below. |
| **Demo for prospects** | Planned: demo.yourdomain.com | Its own database, resets nightly | Fake only | Not built. Today the test site doubles as the demo. |

How a change travels: Claude Code writes it on a branch in GitHub → Vercel makes a preview link → you check it → it's merged into `main` → the test site updates → (once Live exists) it's promoted to Live. Every database change is also rebuilt from scratch on GitHub (the "db-replay" check); if that check fails, the live database couldn't be built from the repo, so fix it before going on.

## Test accounts (test site only)

All test accounts share one password, kept in the password manager as **"Builder Listings — demo password"**. Signed in as **admin@demo.test** (shown as Conner Rutledge), use **See the demo as someone else…** in the menu to switch to any other account without signing out. While you're viewing as someone else, the banner at the top has **Back to Conner Rutledge (admin)**.

**Our team**

| Sign in as | Role | Sees |
|---|---|---|
| admin@demo.test | Platform admin | Everything, every builder, billing, settings |
| coordinator@demo.test | Listing coordinator | MLS work for the builders they're assigned (none assigned = all) |
| photographer@demo.test | Photographer | Only their assigned jobs |

**Builders.** There's one demo builder on each plan, so you can show any setup:

| Builder | Plan | Logins |
|---|---|---|
| Mesquite Creek Homes (demo) | Listing Service+ with our photographer | owner.mesquite, manager.mesquite, marketing.mesquite, sales.mesquite, sales2.mesquite |
| Prairie Lantern Builders (demo) | Software with our photographer | owner.prairie, marketing.prairie |
| Cedar Hollow Homes (demo) | Software only; they enter their own MLS listings | owner.cedar, marketing.cedar, sales.cedar |
| Redbud Ridge Homes (demo) | Listing Service+, their own photographer | owner.redbud, marketing.redbud, sales.redbud |

Every login ends in `@demo.test`. Signed in as one builder, nothing from another builder should ever appear.

On Live there are no shared logins and no "See the demo as someone else" menu. Each person gets their own invite link or join link (below) and sets their own password.

## What each role does

### Platform admin (the owners)
Controls everything. Start at **Admin**.
- **Admin → Onboarding**: add a builder, invite the owner, record the agreement and what we charge, and follow each builder's setup progress (see "Onboarding a new builder").
- **Admin → Builders**: each builder's MLS markets, who enters the MLS (our team or the builder), the website feed, and **feature switches** (comps, reverse prospecting, website check, reports, their Tasks board).
- **Admin → People**: add people and get their invite links, set roles and companies, assign salespeople to communities, choose **Builders they work on** for each listing coordinator, turn someone off (they can't sign in; history stays), and make **Join links**. Every access change is logged.
- **Admin → Billing**: each builder's plan and prices, charges waiting for the next invoice, credits, and monthly invoices. Drafts build themselves on the 1st; you mark them sent and paid. Print to PDF to send. No money moves and nothing is emailed yet.
- **Admin overview**: what needs attention, **file storage used** (warns at 80% of the plan's limit) and **AI credits this month** per builder, where you can also give a builder more credits.
- **Admin → Communities, MLS rules, Photo tags, Photographer pay, Settings** (team email, the storage limit, the log of emails the system would have sent).
- The **builder picker** in the top bar narrows every screen to one builder. It's only a view filter.

### Listing coordinator (our team)
Turns approved homes into MLS listings, by hand. Sees only the builders an admin has ticked for them; if none are ticked, they see every builder.
- **Tasks**: the team board. New listings, MLS updates, status changes and open houses appear on their own.
- Open a task → the **work sheet**: every NTREIS field in Matrix order with copy buttons, photos in MLS order, **Download MLS photo pack**, and the **MLS number → mark live** box.
- **Compliance** and **Website check** for mismatches and deadlines.

### Photographer (contractor)
- **Jobs**: each assigned shoot with address, directions, who to call and access notes. Set the shoot time, upload photos and video (separate boxes), add tour links, **Mark delivered**. Sees existing photos of that home for reference, nothing else.
- **Earnings**: what each completed job pays (tracking only; no money moves).

### Builder owner
Everything for their company. **Communities** is the start page. The owner is also our main contact until they name someone else, and the only builder role that sees **Billing** (their plan, prices and invoices) and the billing contact. Plus:
- **Setup** (their checklist)
- **Company details**: main contact, billing contact, website, default title company
- **Team**: add anyone and get their invite links
- **Branding**: logo, colors, download sizes
- **Tasks**: their to-do board
- **Reports**

### Marketing (the builder's main operator)
Does everything day to day: adds and edits homes (including price, room sizes and NTREIS answers), approves homes for the MLS, changes listing status, runs open houses, sets up communities, manages photos and media, requests photo shoots, works the setup checklist, reads reports, edits company details (except billing), and adds sales and marketing users. No billing.

### Manager
The same access as marketing. In practice, managers follow along and read the reports. No billing.

### Sales
Only their assigned communities: price, availability, status, open houses, change requests, and viewing and downloading media. Can copy a home's **Share link** to send a realtor. Can't add homes, upload media or request photos.

## Adding people: invite links and join links

No email is needed for either one. Both require the Supabase admin key (`SUPABASE_SERVICE_ROLE_KEY`) in Vercel; without it, both are switched off.

**Invite link: one known person.**
1. Add the person: **Admin → People**, the owner box on **Admin → Onboarding**, or the builder's own **Team** page.
2. Click **Get invite link** next to their name, copy it, and send it however you like (text, email, chat).
3. They open it, see their first name and company, and click **Continue**. They confirm their name, choose a password (10+ characters), and land on their setup checklist.

The link lasts 48 hours and stops working once they've set a password. If it expires, click **Make a new link**. Opening the link does nothing until they click Continue, so email security scanners can't use it up.

**Join link: one link for several people in the same role.**
1. Go to **Admin → People → Join links** and pick the role (any role except platform admin).
2. For builder roles, pick the builder; for sales, their communities; for a coordinator, the builders they'll work on.
3. Optionally give it a name, how many days it lasts (7–90) and a cap on how many people can use it.

Each person opens the link, enters their name, email, phone (optional) and a password, and is signed straight in. Whoever made the link gets a notice. There's no approval step, so if the wrong person joins, turn them off on Admin → People. You can turn a join link off at any time.

Use an invite link when you know who the person is. Use a join link for something like "all of Redbud's salespeople."

## Onboarding a new builder

Three stages, each asking only for what the next step needs. The builder fills in most of it themselves.

### 1. Our part: Admin → Onboarding (about 5 minutes)
Under **Add a builder**, enter:
- the display name and the **legal company name** (used as Owner Name on the MLS)
- **Where they build (MLS)**
- the **owner's name and email**

Then, in **Onboarding details (our team only)**, add the agreement and listing-authorization dates, what we charge, and notes.

Set their plan and prices in **Admin → Billing** (open the builder). On **Admin → Builders**, set who enters the MLS and untick any features they aren't getting.

Send the owner their invite link from their card on Onboarding.

### 2. Their part: the setup checklist (Setup tab)
The owner, managers and marketing see a **Setup** tab and a banner until they're done. Each step ticks itself off once the real thing exists:
- **Team**: add their people and send invite links
- **Logo** and **brand guide** (the brand guide is optional, and AI reads it)
- **Website** (required)
- **Billing contact** (owner only)
- **Who photographers call**
- **Default title company** (optional)
- **Communities**, each with its **community setup** (below)
- **Salespeople on communities**
- **Floor plans** (AI reads the plan file for room sizes)
- **First home** (communities and floor plans can be skipped for later)

They can skip the optional steps, and they click **We're all set** at the end. You can open any builder's checklist from **Builder setup** in the menu, or with **Open their checklist** on their Onboarding card. Each card shows the builder's stage (Getting ready → Invited → Setting up → First community ready → First listing approved → Live on the MLS) and anything **Waiting on us**.

### 3. Community setup
Adding a community goes straight to its setup page. That page asks the MLS questions every home in the community shares: schools, HOA, MUD/PID, utilities, lockbox, showing setup and driving directions. A meter shows how ready it is for the MLS. The builder answers these once per community, and our MLS sheet uses them for every home there. If our team types its own answer on the MLS sheet, ours wins.

### Checking it
On the test site, use **See the demo as someone else…**. On Live, ask the owner to share their screen. Confirm that:
- they see only their own company
- salespeople see only their communities
- the right features show

### What the builder receives
Only the links you send them. The system emails nothing until Resend is connected.

## AI credits

Photo labeling, floor plan reading and brand guide reading are paid for from each builder's monthly AI credits: 2,500 a month by default, resetting on the 1st.
- A photo label uses 1 credit, and a floor plan or brand guide read uses 25.
- When a builder runs out, photos still upload, just without AI labels, until next month or until you add credits on the Admin overview.
- Work done by our staff or photographers never uses a builder's credits.

## How the pieces connect

- **GitHub** (`Crutledge13/builder-listing-system`) holds the code and every database change. It's the source of truth.
- **Vercel** runs the site from GitHub: `main` → the test site; every other branch → a preview link.
- **Supabase** holds the data, the logins and the who-sees-what rules. The rules are enforced in the database, so a screen bug can't show the wrong builder's data.
- **Photos and videos** are in private Supabase storage during testing, and move to Cloudflare (R2 for photos, Stream for video) before launch. The free Supabase plan holds 1 GB in total and up to 50 MB per file; the storage meter on the Admin overview shows how close you are.
- **Claude API** labels photos and reads floor plans and brand guides, paid from AI credits, once its key is set in Vercel.
- **Emails**: the system writes every email it means to send to a log (Admin → Settings). Nothing is sent until Resend is connected. People are added with invite and join links, so no email is needed.
- **Billing**: invoices are made in the system. QuickBooks numbers can be recorded; QuickBooks, Stripe and emailing invoices come later.
- **MLS**: our team types listings in by hand. Later, the MLS's read-only feed fills in MLS numbers and status. Nothing is ever sent to the MLS.
- **Builder websites**: today the website check uses sample rows. A real builder's website needs its own small connector.
- **Backups**: three layers (Supabase rewind, an hourly Backblaze vault, a Google Sheet + Dropbox), described in `docs/backups.md`. Built, but not switched on yet.

## Trying it out (test site)

1. **Photographer shoot, start to finish.**
   - As marketing.mesquite, open a home and request photos.
   - As admin, assign photographer@demo.test and a shoot time.
   - As the photographer, open **Jobs**, upload photos and a short video, and mark it delivered.
   - As marketing, review it and mark it complete.
   - Check that the photos landed on the home's listing in order, the MLS photo pack downloads, and a photo charge appears in Admin → Billing for Mesquite Creek.
2. **Walls between builders.** As owner.prairie, search for any Mesquite Creek address or photo. Nothing should come up.
3. **Sales limits.** As sales.mesquite, confirm that only assigned communities show and there's no upload or Add a home.
4. **Home to MLS.**
   - As marketing, add a home and approve it.
   - As coordinator, work the new task and mark it live with a made-up MLS number.
   - Check that a listing fee shows on Mesquite Creek's next invoice.
5. **Builder enters their own MLS listings.** As marketing.cedar, approve a home and confirm it shows on their own **MLS work** tab, not ours.
6. **Turn a feature off.** As admin, switch off comps for Mesquite Creek. As owner.mesquite, confirm **Request comps** is gone.
7. **Onboard a pretend builder.** On Admin → Onboarding, add "Test Homes," get the owner's invite link, open it in a private browser window, and work through the setup checklist as them.

Use your own photos (your house, your office) for upload tests, not a builder's, until Live exists.

## Before real data (from `CLAUDE.md` and `docs/backups.md`)

- Make the GitHub repository **private**.
- Create the live Supabase project (Pro plan), apply the database changes, and turn on point-in-time recovery and leaked-password protection.
- Database warnings: fixed 28 Oct 2026 (`20261028000043_lock_trigger_functions.sql`). The warnings Supabase still shows are intended: share-link functions that must work signed out, and signed-in functions that check the caller themselves.
- Switch on the backups and pass one restore drill.
- Get a paid security review.
- Set up Live in Vercel with its own settings and a real domain. Don't set a demo password there. Set the Supabase admin key so invite and join links work.
