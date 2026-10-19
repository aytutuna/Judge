#!/usr/bin/env bash
# Copies the Verdict SQLite database to /var/lib/verdict/backups and deletes
# copies older than 14 days. Runs nightly via verdict-backup.timer, as the
# verdict user, with /etc/verdict/verdict.env loaded by systemd. Run it now:
#
#   sudo systemctl start verdict-backup && journalctl -u verdict-backup -n 20
#
# Uses SQLite's online backup API (sqlite3 .backup), which takes a
# consistent snapshot while the app keeps running. The database is written
# by libSQL, which keeps the standard SQLite file format.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/lib/verdict/backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

main() {
  local url=${DATABASE_URL:-file:/var/lib/verdict/verdict.db}
  if [[ $url != file:* ]]; then
    echo "DATABASE_URL is not a local file ($url); nothing to back up on this server."
    exit 0
  fi
  local db=${url#file:}
  db=${db%%\?*}
  if [[ ! -f $db ]]; then
    echo "No database at $db yet (the app creates it on first use); skipping."
    exit 0
  fi

  mkdir -p "$BACKUP_DIR"
  local stamp tmp out
  stamp=$(date -u +%Y%m%d-%H%M%S)
  tmp=$BACKUP_DIR/.verdict-$stamp.db.partial
  out=$BACKUP_DIR/verdict-$stamp.db.gz
  # shellcheck disable=SC2064 # expand the paths now
  trap "rm -f -- '$tmp' '$tmp.gz'" EXIT

  echo "Backing up $db"
  sqlite3 "$db" ".timeout 15000" ".backup '$tmp'"
  local check
  check=$(sqlite3 "$tmp" "PRAGMA integrity_check;")
  if [[ $check != ok ]]; then
    echo "ERROR: the backup copy failed its integrity check: $check" >&2
    exit 1
  fi
  gzip -9 "$tmp"
  mv -f -- "$tmp.gz" "$out"
  echo "Wrote $out ($(du -h "$out" | cut -f1))"

  # -mtime +N matches files at least N+1 whole days old.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'verdict-*.db.gz' -mtime +"$((KEEP_DAYS - 1))" -print -delete |
    sed 's/^/Deleted old backup /'
}

main "$@"
