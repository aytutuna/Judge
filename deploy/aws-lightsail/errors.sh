#!/usr/bin/env bash
# Error spike check, every 5 minutes via verdict-errors.timer. Counts the
# last 5 minutes' 5xx responses in Caddy's access log and error lines in the
# app's journal, and when either reaches its limit emails ALERT_EMAIL (see
# alert.sh). After an alert it stays quiet for an hour; spikes in that hour
# are only counted, and the next day brings a one-line digest of the day's
# spikes (none if there were none). Settings in /etc/verdict/verdict.env:
#
#   ALERT_EMAIL            where alerts go (no alerts while empty)
#   ALERT_5XX_THRESHOLD    5xx responses in 5 minutes (default 10)
#   ALERT_ERROR_THRESHOLD  app error lines in 5 minutes (default 20)
#
# Runs as root from the root-owned checkout; its state is in
# /var/lib/verdict-alerts. Run it now: sudo systemctl start verdict-errors
set -euo pipefail
shopt -s nullglob

HERE=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
ACCESS_LOG=/var/log/caddy/access.log
STATE_DIR=${STATE_DIRECTORY:-/var/lib/verdict-alerts}
WINDOW_SEC=300
QUIET_SEC=3600

count_5xx() {
  [[ -r $ACCESS_LOG ]] || {
    echo 0
    return
  }
  tail -n 50000 -- "$ACCESS_LOG" | awk -v since="$1" '
    /"status":5[0-9][0-9][,}]/ && match($0, /"ts":[0-9.]+/) && substr($0, RSTART + 5, RLENGTH - 5) + 0 >= since { n++ }
    END { print n + 0 }'
}

app_errors() {
  journalctl -u verdict -p err --since "@$1" -o cat -q --no-pager || true
}

# The first 300 characters of each line. cut -c counts bytes, so it could
# split a multibyte character and break the email's JSON.
clip() {
  local LC_ALL=C.UTF-8 line
  while IFS= read -r line; do printf '%s\n' "${line:0:300}"; done
}

alert() { bash "$HERE/alert.sh" "$@"; }

# Sends the digest for each earlier day that had spikes, then forgets it.
send_digests() {
  local today=$1 file day summary
  for file in "$STATE_DIR"/spikes-*; do
    day=${file##*/spikes-}
    [[ $day == "$today" ]] && continue
    summary=$(awk '
      { if (!first) first = $1; last = $1; n++
        if ($2 > p5) p5 = $2; if ($3 > pe) pe = $3 }
      END { printf "%d %s over the limit between %s and %s UTC; at most %d 5xx responses and %d app errors in 5 minutes.", n, n == 1 ? "check" : "checks", first, last, p5, pe }' "$file")
    if alert "Judge error spikes on $day" "$summary"; then rm -f -- "$file"; fi
  done
}

main() {
  local now since today n5 ne
  now=$(date +%s)
  since=$((now - WINDOW_SEC))
  today=$(date -u +%F)
  local max5=${ALERT_5XX_THRESHOLD:-10} maxe=${ALERT_ERROR_THRESHOLD:-20}

  send_digests "$today"

  n5=$(count_5xx "$since")
  ne=$(app_errors "$since" | wc -l)
  ((n5 >= max5 || ne >= maxe)) || exit 0

  echo "Error spike: $n5 5xx responses (limit $max5), $ne app errors (limit $maxe) in 5 minutes"
  printf '%s %s %s\n' "$(date -u +%H:%M)" "$n5" "$ne" >>"$STATE_DIR/spikes-$today"

  local last=0
  if [[ -f $STATE_DIR/last-alert ]]; then last=$(<"$STATE_DIR/last-alert"); fi
  if ((now - last < QUIET_SEC)); then
    echo "An alert went out less than an hour ago; not sending another."
    exit 0
  fi

  local site=${NEXT_PUBLIC_SITE_URL:-Judge} text
  text="In the last 5 minutes $site answered $n5 requests with a 5xx status (limit $max5) and the app logged $ne errors (limit $maxe).

Latest app errors:
$(app_errors "$since" | tail -n 5 | clip)

On the server: journalctl -u verdict -p err --since -1h
No further alert for an hour; tomorrow's digest counts any more spikes today."
  if alert "Judge errors spiking on ${site#https://}" "$text"; then
    echo "$now" >"$STATE_DIR/last-alert"
  fi
}

main "$@"
