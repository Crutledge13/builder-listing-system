#!/usr/bin/env bash
# Layer 2: copy every photo and video original to Backblaze B2.
# --immutable means files already in the vault are never overwritten, and
# "copy" never deletes, so a mistake or an attacker can't erase the vault copy.
set -euo pipefail
source "$(dirname "$0")/rclone-env.sh"
rclone copy "supa:media" "b2:$B2_BUCKET/media" --immutable --transfers 8 --stats-one-line --stats 30s
echo "Media backup done."
