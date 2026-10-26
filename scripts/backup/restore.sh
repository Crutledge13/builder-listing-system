#!/usr/bin/env bash
# Restores a vault backup into a database: the latest one, or BACKUP_FILE
# (e.g. database/2026/10/26/1307Z.tar.gpg).
#
# Target (RESTORE_DB_URL) must be a fresh, empty Supabase project, never the
# live one. Our tables, rules and functions come back from app.dump; logins
# and file records from auth.dump. Then row counts are checked against the
# manifest saved with the backup.
set -euo pipefail
source "$(dirname "$0")/rclone-env.sh"
PG="${PG_BIN:-/usr/lib/postgresql/17/bin}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -z "${RESTORE_DB_URL:-}" ]; then echo "::error::RESTORE_DB_URL isn't set."; exit 1; fi
if [ "${RESTORE_DB_URL}" = "${SUPABASE_DB_URL:-}" ]; then echo "::error::Refusing to restore over the live database."; exit 1; fi

file="${BACKUP_FILE:-}"
if [ -z "$file" ]; then
  file=$(rclone lsf -R --files-only "b2:$B2_BUCKET/database" | grep '\.tar\.gpg$' | sort | tail -1)
  file="database/$file"
fi
echo "Restoring $file"
rclone copyto "b2:$B2_BUCKET/$file" "$work/backup.tar.gpg"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --decrypt --output "$work/backup.tar" "$work/backup.tar.gpg"
tar -C "$work" -xf "$work/backup.tar"

# Logins and file records first: our tables point at them.
# (session_replication_role=replica skips triggers while loading saved rows.)
export PGOPTIONS="-c session_replication_role=replica"
"$PG/psql" "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -q -c "truncate auth.identities, auth.users, storage.objects, storage.buckets cascade;"
"$PG/pg_restore" --dbname="$RESTORE_DB_URL" --no-owner --no-privileges --data-only --exit-on-error "$work/auth.dump"

# Our schemas: start clean so the drill can run again on the same target.
"$PG/psql" "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists private cascade; drop schema if exists public cascade;"
# Keeps the grants (who may read which table), which row-level security relies on.
"$PG/pg_restore" --dbname="$RESTORE_DB_URL" --no-owner --exit-on-error "$work/app.dump"
unset PGOPTIONS

echo "Checking row counts against the backup's manifest..."
"$PG/psql" "$RESTORE_DB_URL" -At -c "
  select coalesce(json_object_agg(t, c), '{}') from (
    select n.nspname || '.' || c.relname as t,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as c
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
  ) x" > "$work/restored.json"
python3 - "$work/manifest.json" "$work/restored.json" <<'PY'
import json, sys
want = json.load(open(sys.argv[1])) or {}
got = json.load(open(sys.argv[2])) or {}
bad = []
for table, n in sorted(want.items()):
    have = got.get(table)
    # Counts are taken right after the copy, so a busy table may differ by a row or two.
    if have is None or abs(have - n) > max(2, n * 0.01):
        bad.append(f"{table}: backup had {n}, restored {have}")
print(f"{len(want)} tables checked, {len(bad)} problems")
for b in bad: print("  " + b)
sys.exit(1 if bad else 0)
PY
echo "Restore drill passed."
