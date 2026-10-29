#!/usr/bin/env bash
# Copies the newest nightly backup off the server: encrypts it with
# BACKUP_PASSPHRASE (gpg, AES-256) and uploads it with rclone to an
# S3-compatible bucket, e.g. Cloudflare R2, together with an encrypted copy
# of the removal log. Copies older than BACKUP_KEEP_DAYS (default 14, what
# the privacy page promises) are deleted from the bucket. Started by
# verdict-backup.service when it finishes, as the verdict user, with
# /etc/verdict/verdict.env loaded by systemd:
#
#   BACKUP_S3_ENDPOINT    e.g. https://<account id>.r2.cloudflarestorage.com
#   BACKUP_S3_BUCKET      bucket name, optionally with a folder: bucket/judge
#   BACKUP_S3_ACCESS_KEY  access key ID
#   BACKUP_S3_SECRET_KEY  secret access key
#   BACKUP_PASSPHRASE     encrypts the copies; keep it in a password manager
#
# Without the BACKUP_S3_* settings it only checks that the backup worked. If
# the backup failed or is over a day old, or the upload fails, it emails
# ALERT_EMAIL (see alert.sh). Run it now:
#
#   sudo systemctl start verdict-backup-upload && journalctl -u verdict-backup-upload -n 20
set -euo pipefail

HERE=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
BACKUP_DIR=${BACKUP_DIR:-/var/lib/verdict/backups}
REMOVALS_LOG=${REMOVAL_LOG:-/var/lib/verdict/removals.log}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
MAX_AGE_SEC=$((26 * 3600))

fail() {
  echo "ERROR: $*" >&2
  bash "$HERE/alert.sh" "Judge backup problem" "$*

On the server: journalctl -u verdict-backup -u verdict-backup-upload -n 50" || true
  exit 1
}

encrypt() {
  gpg --batch --quiet --yes --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --output "$2" "$1" 3<<<"$BACKUP_PASSPHRASE"
}

main() {
  # Set by systemd when verdict-backup.service started this unit.
  if [[ ${MONITOR_SERVICE_RESULT:-success} != success ]]; then
    fail "The database backup failed ($MONITOR_SERVICE_RESULT), so there is no new copy."
  fi
  local newest
  newest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'verdict-*.db.gz' -printf '%T@ %p\n' 2>/dev/null |
    sort -n | tail -n 1 | cut -d' ' -f2-)
  [[ -n $newest ]] || fail "There is no backup in $BACKUP_DIR: the nightly backup is not working."
  (($(date +%s) - $(stat -c %Y "$newest") < MAX_AGE_SEC)) ||
    fail "The newest backup, $(basename "$newest"), is more than a day old: the nightly backup is not working."

  if [[ -z ${BACKUP_S3_ENDPOINT-} || -z ${BACKUP_S3_BUCKET-} || -z ${BACKUP_S3_ACCESS_KEY-} || -z ${BACKUP_S3_SECRET_KEY-} ]]; then
    echo "Off-server copies are off (BACKUP_S3_* not set); skipping."
    exit 0
  fi
  [[ -n ${BACKUP_PASSPHRASE-} ]] || fail "BACKUP_S3_* is set but BACKUP_PASSPHRASE is not, so no off-server copy was made."

  # rclone reads its S3 settings from the environment, so no secret is on
  # its command line or in a config file.
  export RCLONE_S3_PROVIDER=Other RCLONE_S3_ENDPOINT=$BACKUP_S3_ENDPOINT \
    RCLONE_S3_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY RCLONE_S3_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_KEY \
    RCLONE_S3_NO_CHECK_BUCKET=true RCLONE_CONFIG=/dev/null
  local remote=:s3:${BACKUP_S3_BUCKET%/}
  local work name size remote_size
  work=$(mktemp -d)
  # shellcheck disable=SC2064 # expand the path now
  trap "rm -rf -- '$work'" EXIT
  export GNUPGHOME=$work/gnupg
  install -d -m 700 "$GNUPGHOME"

  name=$(basename "$newest").gpg
  encrypt "$newest" "$work/$name" || fail "Could not encrypt $(basename "$newest")."
  # Pruning goes by this time, so it counts from the backup, not the upload.
  touch -r "$newest" "$work/$name"
  size=$(stat -c %s "$work/$name")
  echo "Uploading $name ($size bytes)"
  rclone copyto --retries 3 "$work/$name" "$remote/$name" || fail "Uploading $name to $BACKUP_S3_BUCKET failed."
  remote_size=$(rclone lsf --format s "$remote/$name" 2>/dev/null || true)
  [[ $remote_size == "$size" ]] ||
    fail "Uploaded $name, but the bucket reports ${remote_size:-no file} instead of $size bytes."

  if [[ -f $REMOVALS_LOG ]]; then
    encrypt "$REMOVALS_LOG" "$work/removals.log.gpg" || fail "Could not encrypt the removal log."
    rclone copyto --retries 3 "$work/removals.log.gpg" "$remote/removals.log.gpg" ||
      fail "Uploading the removal log to $BACKUP_S3_BUCKET failed."
  fi

  rclone delete -v --min-age "${KEEP_DAYS}d" --include 'verdict-*.db.gz.gpg' "$remote" ||
    fail "Deleting old copies from $BACKUP_S3_BUCKET failed."
  echo "Done: $name is in $BACKUP_S3_BUCKET"
}

main "$@"
