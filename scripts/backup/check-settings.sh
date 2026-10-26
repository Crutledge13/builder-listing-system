#!/usr/bin/env bash
# Stops the backup with a plain message if a required setting is missing.
set -euo pipefail
missing=()
for name in SUPABASE_DB_URL BACKUP_PASSPHRASE B2_KEY_ID B2_APP_KEY B2_BUCKET; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::Backups aren't set up yet. Missing GitHub secrets: ${missing[*]}. See docs/backups.md."
  exit 1
fi
[ -n "${SUPABASE_S3_KEY_ID:-}" ] || echo "::warning::Photo/video originals aren't backed up yet (SUPABASE_S3_* secrets missing)."
[ -n "${GOOGLE_SHEET_ID:-}" ] || echo "::notice::Google Sheet copy not connected yet."
[ -n "${DROPBOX_REFRESH_TOKEN:-}" ] || echo "::notice::Dropbox photo mirror not connected yet."
[ -n "${HEALTHCHECK_URL:-}" ] || echo "::warning::No HEALTHCHECK_URL: nobody is alerted if backups stop running."
echo "Settings OK."
