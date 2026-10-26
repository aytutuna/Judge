#!/usr/bin/env bash
# Restores the Judge database from a nightly backup.
#
#   sudo verdict-restore                         # list available backups
#   sudo verdict-restore verdict-20261018-033512.db.gz
#
# Stops the app, keeps the current database next to it as
# verdict.db.before-restore-<time>, puts the backup in place, re-applies
# every removal made since (from the removal log, which lives outside the
# database file and is not replaced), and starts the app again. Verdicts
# saved after that backup was taken are not in it. If the removals cannot be
# re-applied, the app stays stopped: starting it would bring removed
# verdicts, originals and share links back.
set -euo pipefail

APP_USER=verdict
APP_DIR=/opt/verdict
DATA_DIR=/var/lib/verdict
DB=$DATA_DIR/verdict.db
BACKUP_DIR=$DATA_DIR/backups
ENV_FILE=/etc/verdict/verdict.env
HEALTH_URL=http://127.0.0.1:3000/api/health

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  [[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash $0 <backup file>"

  if [[ $# -eq 0 ]]; then
    echo "Backups in $BACKUP_DIR (newest last):"
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'verdict-*.db.gz' -printf '  %f  (%s bytes)\n' 2>/dev/null | sort
    echo
    echo "Restore one with: sudo verdict-restore <file name>"
    exit 0
  fi

  local backup=$1
  [[ -f $backup ]] || backup=$BACKUP_DIR/$1
  [[ -f $backup ]] || die "No such backup: $1"
  gzip -t "$backup" || die "$backup is not a valid .gz file."

  local stamp staged
  stamp=$(date -u +%Y%m%d-%H%M%S)
  staged=$DATA_DIR/.restore-$stamp.db
  # shellcheck disable=SC2064 # expand the path now
  trap "rm -f -- '$staged'" EXIT

  echo "==> Unpacking and checking $(basename "$backup")"
  gzip -dc "$backup" >"$staged"
  chown "$APP_USER:$APP_USER" "$staged"
  chmod 600 "$staged"
  [[ $(sqlite3 "$staged" "PRAGMA integrity_check;") == ok ]] || die "The backup failed its integrity check."

  echo "==> Stopping the app"
  systemctl stop verdict

  if [[ -f $DB ]]; then
    local suffix
    # Keep the WAL files with the database they belong to; a stale WAL left
    # beside the restored file would corrupt it.
    for suffix in "" -wal -shm; do
      if [[ -f $DB$suffix ]]; then mv -f -- "$DB$suffix" "$DB.before-restore-$stamp$suffix"; fi
    done
    echo "    Previous database kept as $DB.before-restore-$stamp"
  fi
  mv -f -- "$staged" "$DB"

  echo "==> Re-applying removals made after that backup (removal log)"
  # Removals (verdicts, case sides, deleted accounts) newer than the backup
  # would otherwise be undone by this restore.
  if ! (cd "$APP_DIR/current" &&
    runuser -u "$APP_USER" -- ./node_modules/.bin/tsx --env-file="$ENV_FILE" scripts/originals.ts replay-removals); then
    die "Could not re-apply removals, so the app is left stopped (starting it would bring removed verdicts back).
Fix the error above, then run:
  cd $APP_DIR/current && sudo -u $APP_USER ./node_modules/.bin/tsx --env-file=$ENV_FILE scripts/originals.ts replay-removals
  sudo systemctl start verdict"
  fi

  echo "==> Starting the app"
  systemctl start verdict
  local waited=0
  while ((waited < 60)); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "==> Restored. The site is up."
      exit 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  die "The app did not come back up. Check: journalctl -u verdict -n 100"
}

main "$@"
