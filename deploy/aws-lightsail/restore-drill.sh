#!/usr/bin/env bash
# Monthly check that the newest backup would restore: unpacks it to a temp
# file, runs SQLite's integrity check and counts the verdicts and cases in
# it, then deletes the copy. Nothing on the live site is touched. Started by
# verdict-restore-drill.timer, as the verdict user; a failure sends an alert
# (see alert.sh), a pass is one journal line that the daily heartbeat
# repeats. Run it now:
#
#   sudo systemctl start verdict-restore-drill && journalctl -u verdict-restore-drill -n 5
set -euo pipefail

HERE=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
BACKUP_DIR=${BACKUP_DIR:-/var/lib/verdict/backups}

fail() {
  echo "Restore drill failed: $*" >&2
  bash "$HERE/alert.sh" "Judge restore drill failed" "$*

The nightly backups may not be usable. On the server: journalctl -u verdict-restore-drill -u verdict-backup -n 50" || true
  exit 1
}

# Rows in table $2 of database $1; 0 if the table is not there yet (the app
# creates tables on first use).
rows() {
  if [[ $(sqlite3 "$1" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '$2';") == 0 ]]; then
    echo 0
  else
    sqlite3 "$1" "SELECT count(*) FROM $2;"
  fi
}

main() {
  local newest
  newest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'verdict-*.db.gz' -printf '%T@ %p\n' 2>/dev/null |
    sort -n | tail -n 1 | cut -d' ' -f2-)
  [[ -n $newest ]] || fail "There is no backup in $BACKUP_DIR."

  local work db check verdicts cases size free
  work=$(mktemp -d)
  # shellcheck disable=SC2064 # expand the path now
  trap "rm -rf -- '$work'" EXIT
  # Unpacking into a nearly full disk would fill it for the live site too.
  size=$(gzip -l "$newest" | awk 'NR == 2 { print $2 }') || fail "$(basename "$newest") does not unpack."
  free=$(($(df --output=avail -k "$work" | tail -n 1) * 1024))
  if ((free < 2 * size)); then
    size="$(((size + 1048575) >> 20)) MB" free="$((free >> 20)) MB"
    echo "Restore drill skipped on $(date -u +%F): $(basename "$newest") unpacks to $size, only $free free"
    bash "$HERE/alert.sh" "Judge restore drill skipped: low disk" "$(basename "$newest") unpacks to $size, but only $free is free for the copy, so the drill did not run.

Free up space, then run it again. On the server: sudo du -xh --max-depth=2 / | sort -h | tail -n 15; sudo systemctl start verdict-restore-drill" || true
    return 0
  fi
  db=$work/drill.db
  gzip -dc "$newest" >"$db" || fail "$(basename "$newest") does not unpack."
  check=$(sqlite3 "$db" "PRAGMA integrity_check;" 2>&1) || true
  [[ $check == ok ]] || fail "$(basename "$newest") failed its integrity check: ${check:0:300}"
  verdicts=$(rows "$db" verdicts) || fail "Could not count the verdicts in $(basename "$newest")."
  cases=$(rows "$db" cases) || fail "Could not count the cases in $(basename "$newest")."
  echo "Restore drill passed on $(date -u +%F): $(basename "$newest"), $verdicts verdicts, $cases cases"
}

main "$@"
