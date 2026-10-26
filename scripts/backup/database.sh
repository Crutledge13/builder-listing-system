#!/usr/bin/env bash
# Layer 2: a full, encrypted copy of the database sent to Backblaze B2.
#
# Two files per run, plus a manifest of row counts used by the restore drill:
#   app.dump    our schemas (public, private): tables, rules, functions and data
#   auth.dump   logins and file records (auth.users, auth.identities, storage.*), data only
set -euo pipefail
source "$(dirname "$0")/rclone-env.sh"
PG="${PG_BIN:-/usr/lib/postgresql/17/bin}"
stamp=$(date -u +%Y/%m/%d/%H%MZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Dumping app schemas..."
"$PG/pg_dump" "$SUPABASE_DB_URL" --format=custom --no-owner \
  --schema=public --schema=private --file="$work/app.dump"

echo "Dumping logins and file records..."
"$PG/pg_dump" "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --data-only \
  --table=auth.users --table=auth.identities --table=storage.buckets --table=storage.objects \
  --file="$work/auth.dump"

echo "Counting rows..."
# Exact row counts for every table we back up; the restore drill compares against these.
"$PG/psql" "$SUPABASE_DB_URL" -At -c "
  select coalesce(json_object_agg(t, c), '{}') from (
    select n.nspname || '.' || c.relname as t,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as c
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
  ) x" > "$work/manifest.json"
"$PG/psql" "$SUPABASE_DB_URL" -At -c "select json_build_object(
    'taken_at', now(),
    'logins', (select count(*) from auth.users),
    'files', (select count(*) from storage.objects),
    'tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private')))" > "$work/counts.json"
cat "$work/counts.json"

# One encrypted bundle. Only someone with BACKUP_PASSPHRASE can open it.
tar -C "$work" -cf "$work/backup.tar" app.dump auth.dump manifest.json counts.json
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
  --symmetric --cipher-algo AES256 --output "$work/backup.tar.gpg" "$work/backup.tar"

size=$(du -h "$work/backup.tar.gpg" | cut -f1)
echo "Uploading $size to b2:$B2_BUCKET/database/$stamp.tar.gpg"
rclone copyto "$work/backup.tar.gpg" "b2:$B2_BUCKET/database/$stamp.tar.gpg"
rclone copyto "$work/counts.json" "b2:$B2_BUCKET/database/latest-counts.json" 2>/dev/null || true
echo "Database backup done."
