# Backups

Three layers, each with a different company, so no single outage, mistake or hacked account can wipe us out. Real builder data goes in only after all three are running and a restore drill has passed.

| Layer | What | Where | How often | Status |
|---|---|---|---|---|
| 1. Undo to any second | Rewind the database to an exact moment | Supabase point-in-time recovery (paid add-on, live project) | Continuous | Not on yet: needs the live project on Supabase Pro |
| 2. Off-site vault | Encrypted full database copy + every photo/video original | Backblaze B2 | Hourly | Built (`.github/workflows/backup-hourly.yml`); needs accounts and secrets below |
| 3. Readable copies | Google Sheet (tab per builder) + Dropbox photo folders | Google, Dropbox | Hourly | Built (`scripts/backup/readable-copy.mjs`); needs accounts and secrets below |

Plus: a **restore drill** every three months (`.github/workflows/restore-drill.yml`) that restores the latest vault copy into a scratch project and checks every table came back, and **alerts** through Healthchecks.io if a backup fails or stops running.

## How layer 2 works

Every hour GitHub runs `scripts/backup/database.sh` and `scripts/backup/media.sh` on its own computers (so it works even if Supabase or Vercel is down):

- `app.dump`: our tables, security rules, functions, triggers and data (schemas `public` and `private`)
- `auth.dump`: logins and file records (`auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`)
- `manifest.json`: exact row count of every table, used to check restores
- All bundled and encrypted with `BACKUP_PASSPHRASE` (AES-256) before it leaves GitHub, saved as `database/YYYY/MM/DD/HHMMZ.tar.gpg`
- Photo and video originals are copied to `media/`. Copies never overwrite or delete, so the vault keeps a file even if it's deleted or altered in Supabase.

Tested locally (Postgres + a stand-in vault): backup, encrypt, upload, then restore into an empty database. Rows, logins, security rules, triggers and table permissions all came back; a wrong passphrase is refused; an altered photo is not overwritten in the vault.

Cost: GitHub Actions minutes are free up to 2,000 a month on a private repo; this uses about 750. Backblaze B2 is about $6 per TB per month.

## Setup checklist (in this order)

### 1. Live Supabase project with point-in-time recovery (layer 1)
1. Upgrade the Supabase organization to **Pro**.
2. Create the live project (region **us-east-2**, same as test). Save the database password in your password manager.
3. Project → **Database → Backups → Point in time recovery**: turn on (7 days to start).
4. Tell Claude the project is created; it applies the migrations (database rules) to it.

### 2. Backblaze B2 vault (layer 2)
1. Create a Backblaze account with a **separate email and password** from everything else, with two-factor login turned on.
2. **Buckets → Create a bucket**: private, name like `builder-listings-vault`, **Object Lock: enabled** (default retention: Governance, 30 days). Lifecycle: keep all versions.
3. **Application Keys → Add a new key**: only this bucket, **Read and Write** (if offered, leave out delete permissions). Copy the keyID and applicationKey; they're shown once.

### 3. Supabase connection details (for the backup job)
1. Live project → **Connect → Session pooler**: copy the connection string (`postgresql://postgres.<ref>:[PASSWORD]@aws-...pooler.supabase.com:5432/postgres`) and put in the database password. GitHub's computers need the session pooler address.
2. **Storage → S3 Connection → New access key**: copy the endpoint, region, access key ID and secret. (Used to copy photo originals.)
3. **Project Settings → API → service_role key** (only for layer 3).

### 4. Alerts
1. Create a free account at healthchecks.io → **Add check** → schedule: every 1 hour, grace 30 minutes → add your email (and phone/SMS if wanted).
2. Copy the ping URL.

### 5. Layer 3 (readable copies)
- **Google Sheet:** create a blank sheet named "Builder Listings backup". In Google Cloud, create a service account, give it a JSON key, enable the Google Sheets API, and share the sheet with the service account's email as Editor. Copy the sheet ID (the long part of its address).
- **Dropbox:** create a Dropbox app (scoped access, "App folder"), permissions `files.content.write` and `files.metadata.read`, then generate a refresh token. Copy the app key, app secret and refresh token.

### 6. Put the secrets in GitHub
GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | From |
|---|---|
| `SUPABASE_DB_URL` | Step 3.1 |
| `BACKUP_PASSPHRASE` | Make a long random passphrase and **store it in your password manager**. Without it, backups can't be opened. |
| `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET` | Step 2 |
| `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_KEY_ID`, `SUPABASE_S3_SECRET` | Step 3.2 |
| `HEALTHCHECK_URL` | Step 4 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Live project (layer 3) |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID` | Step 5 |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` | Step 5 |
| `RESTORE_DB_URL` | Session pooler string of a **separate scratch Supabase project** (free tier is fine), used only by the drill |

Then **Variables → New repository variable**: `BACKUPS_ENABLED` = `true`.

### 7. Prove it works
1. **Actions → Hourly backup → Run workflow.** It should finish green and the file should appear in the B2 bucket.
2. **Actions → Restore drill → Run workflow.** It should end with "Restore drill passed."
3. Check the Google Sheet and Dropbox folder.
4. Only then load real builder data.

## Restoring for real

- **Everyday mistake** (wrong edit, deleted listing): first check the 30-day trash and the activity log. For anything bigger, use Supabase **point-in-time recovery** to rewind to just before it.
- **Supabase problem or lost project:** create a new project, then run **Actions → Restore drill** with `RESTORE_DB_URL` pointing at it and the backup file you want. Re-create the daily open house job (`supabase/migrations/20261026000009_tasks_team_listing_status.sql`, last line), copy photo originals back from `media/` in B2 to the new storage bucket, and point Vercel at the new project.
- **Single photo:** download it from the vault's `media/` folder (same path as in Supabase Storage) or from Dropbox.

## Good to know

- GitHub pauses scheduled jobs in repositories with no activity for 60 days. Healthchecks.io alerts you if that happens; any commit or a manual run restarts them.
- The readable copies run hourly, not "seconds after any change". Instant updates can be added later with a database webhook if the hourly sheet isn't fresh enough.
- Keep `BACKUP_PASSPHRASE` and the Backblaze login out of Supabase, Vercel and GitHub accounts' recovery emails, so one hacked account can't reach both the system and its backups.
