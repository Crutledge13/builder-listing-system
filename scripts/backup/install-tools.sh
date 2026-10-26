#!/usr/bin/env bash
# Postgres 17 client (must match the database's version) and rclone.
set -euo pipefail
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql-client-17 rclone > /dev/null
/usr/lib/postgresql/17/bin/pg_dump --version
rclone version | head -1
