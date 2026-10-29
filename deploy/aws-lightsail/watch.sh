#!/usr/bin/env bash
# The server's watcher, every minute via verdict-watch.timer. It sends an
# alert (email and phone push, see alert.sh) when:
#
#   - the app logs an [alert:...] line (the AI service is out of credit,
#     refuses or does not permit the API key, or does not know CLAUDE_MODEL)
#   - someone logs in over SSH, or runs sudo for anything but the
#     verdict-update and verdict-restore commands or a backup
#   - the env file, a verdict unit, the Caddyfile, a verdict-* command or the
#     live release changes outside a deploy
#   - a new port is listening
#   - the app logs too many [signal:...] lines, or fail2ban bans too many
#     addresses, in 5 minutes
#   - the app restarted on its own, a service failed, the kernel killed a
#     process for lack of memory, a disk is 90% full, or the site's
#     certificate expires within 10 days
#
# The first four are critical pushes. Each kind of alert then stays quiet for
# an hour. Once a day after 09:00 (server time) it sends a heartbeat with the
# last day's numbers; if that stops arriving, this watcher is broken.
#
# Signal limits come from /etc/verdict/verdict.env as ALERT_SIGNAL_<NAME>=n,
# e.g. ALERT_SIGNAL_RATE_LIMITED=100 (defaults in SIGNAL_LIMITS below).
#
#   watch.sh               run every check
#   watch.sh --rebaseline  take the current ports and files as the expected
#                          ones (update.sh runs it after a deploy)
#
# Runs as root from the root-owned checkout; its state is in
# /var/lib/verdict-alerts. Run it now: sudo systemctl start verdict-watch
set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

HERE=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
STATE_DIR=${STATE_DIRECTORY:-/var/lib/verdict-alerts}
ACCESS_LOG=/var/log/caddy/access.log
DATA_DIR=/var/lib/verdict
CURRENT_LINK=/opt/verdict/current
QUIET_SEC=3600
WINDOW_SEC=300
DEPLOY_GRACE_MIN=30
DISK_LIMIT=90
CERT_MIN_DAYS=10

declare -A SIGNAL_LIMITS=(
  [rate_limited]=50 [turnstile_fail]=30 [bad_origin]=10 [bearer_401]=30
  [webhook_bad_secret]=3 [webhook_apply_failed]=1 [entitlement_refused]=3
  [provider_rate]=10 [provider_down]=5 [ban]=20
)

now=$(date +%s)

log() { printf '%s\n' "$*"; }

# The first 300 characters of each line (by character, not byte).
clip() {
  local line
  while IFS= read -r line; do printf '%s\n' "${line:0:300}"; done
}

mask_ip() {
  if [[ $1 =~ ^([0-9]+\.[0-9]+)\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s.x.x' "${BASH_REMATCH[1]}"
  elif [[ $1 =~ ^([0-9a-fA-F]*:[0-9a-fA-F]*): ]]; then
    printf '%s::x' "${BASH_REMATCH[1]}"
  else
    printf 'an unknown address'
  fi
}

# notify KEY [--critical] SUBJECT TEXT: sends the alert unless KEY alerted in
# the last hour. True if it went out, or if there is nowhere to send it (then
# it is only logged); false while quiet or when sending failed.
notify() {
  local key=${1//[^A-Za-z0-9._-]/_} critical="" file last=0
  shift
  if [[ $1 == --critical ]]; then
    critical=--critical
    shift
  fi
  file=$STATE_DIR/quiet-$key
  log "$1"
  if [[ -z ${ALERT_EMAIL-}${NTFY_TOPIC-} ]]; then return 0; fi
  if [[ -f $file ]]; then last=$(<"$file"); fi
  if ((now - ${last:-0} < QUIET_SEC)); then
    log "  (an alert like this went out less than an hour ago)"
    return 1
  fi
  bash "$HERE/alert.sh" ${critical:+"$critical"} "$1" "$2" || return 1
  echo "$now" >"$file"
}

# journal_new NAME MATCHES...: the messages matching MATCHES since this
# check last ran. The first run only notes where the journal ends.
journal_new() {
  local file=$STATE_DIR/cursor-$1
  shift
  if [[ ! -s $file ]]; then
    journalctl -q --no-pager -n 1 --show-cursor -o cat | sed -n 's/^-- cursor: //p' >"$file"
    return 0
  fi
  journalctl -q --no-pager -o cat --cursor-file="$file" "$@"
}

in_deploy_window() {
  [[ -n $(find "$STATE_DIR/deploy-at" -mmin -"$DEPLOY_GRACE_MIN" 2>/dev/null) ]]
}

check_app_alerts() {
  local line key subject todo crit
  while IFS= read -r line; do
    [[ $line =~ ^\[alert:([a-z_]+)\] ]] || continue
    key=${BASH_REMATCH[1]}
    crit=--critical
    case $key in
      provider_credit)
        subject="Judge: the AI service is out of credit"
        todo="Verdicts fail until it has credit again: top up the account or raise its spend limit in the provider's console."
        ;;
      provider_auth)
        if [[ $line == *"HTTP 403"* || $line == *permission_error* ]]; then
          subject="Judge: the AI service says the API key is not permitted"
          todo="Verdicts fail until the key is allowed to use the model: check the key's workspace and permissions in the provider's console, or put another ANTHROPIC_API_KEY in /etc/verdict/verdict.env, then sudo systemctl restart verdict."
        else
          subject="Judge: the AI service refused the API key"
          todo="Verdicts fail until the key works: put a valid ANTHROPIC_API_KEY in /etc/verdict/verdict.env, then sudo systemctl restart verdict."
        fi
        ;;
      provider_config)
        subject="Judge: the AI service does not know the model, check CLAUDE_MODEL"
        todo="Verdicts fail until the model name is right: check CLAUDE_MODEL and CLAUDE_MODEL_LITE in /etc/verdict/verdict.env (a retired or mistyped model), then sudo systemctl restart verdict."
        ;;
      *)
        # A kind this watcher does not know: all of them share one quiet,
        # non-critical alert.
        subject="Judge: the app logged [alert:$key]"
        todo=""
        key=other
        crit=""
        ;;
    esac
    notify "alert-$key" ${crit:+"$crit"} "$subject" "The app logged:
$(clip <<<"$line")

$todo
On the server: journalctl -u verdict -p err --since -1h" || true
  done < <(journal_new app-alerts -u verdict -p err)
}

check_logins() {
  local line method user ip
  while IFS= read -r line; do
    [[ $line =~ ^Accepted\ ([^ ]+)\ for\ ([^ ]+)\ from\ ([^ ]+)\ port ]] || continue
    method=${BASH_REMATCH[1]}
    user=${BASH_REMATCH[2]//[^A-Za-z0-9._-]/?}
    ip=$(mask_ip "${BASH_REMATCH[3]}")
    notify "ssh-$user-$ip" --critical "Judge: SSH login as $user from $ip" "Someone logged in to the server over SSH as $user from $ip ($method).

If it was not you, the server is compromised: stop it in the provider's console, then rotate every key in /etc/verdict/verdict.env.
On the server: journalctl -t sshd --since -1h" || true
  done < <(journal_new ssh SYSLOG_IDENTIFIER=sshd SYSLOG_IDENTIFIER=sshd-session)
}

check_sudo() {
  local line user cmd prog
  while IFS= read -r line; do
    [[ $line =~ ^\ *([^ ]+)\ :\ .*COMMAND=(.*)$ ]] || continue
    user=${BASH_REMATCH[1]//[^A-Za-z0-9._-]/?}
    cmd=${BASH_REMATCH[2]}
    if [[ $cmd =~ ^/usr/local/sbin/verdict-(update|restore)(\ |$) ||
      $cmd =~ ^/usr/bin/systemctl\ start\ verdict-backup(\.service)?$ ]]; then
      continue
    fi
    # Only the program: the arguments could hold a secret.
    prog=${cmd%% *}
    prog=${prog//[^A-Za-z0-9._\/-]/?}
    notify "sudo-$user-${prog##*/}" --critical "Judge: $user ran sudo $prog" "$user ran $prog as root through sudo (arguments left out).

If it was not you, someone has a shell on the server.
On the server: journalctl -t sudo --since -1h" || true
  done < <(journal_new sudo SYSLOG_IDENTIFIER=sudo)
}

# One "<sha256>  <path>" line per watched file, and the live release.
integrity_now() {
  {
    find /etc/verdict/verdict.env /etc/caddy/Caddyfile /etc/systemd/system/verdict* \
      /usr/local/sbin/verdict-* -type f -print0 2>/dev/null || true
  } | sort -z | xargs -0 -r sha256sum
  printf '%s  %s\n' "$(readlink -f "$CURRENT_LINK" || echo none)" "$CURRENT_LINK"
}

check_integrity() {
  local file=$STATE_DIR/integrity current changed
  current=$(integrity_now)
  if [[ ! -f $file ]] || in_deploy_window; then
    printf '%s\n' "$current" >"$file"
    return 0
  fi
  changed=$(comm -3 <(sort "$file") <(sort <<<"$current") | awk '{ print $2 }' | sort -u)
  [[ -n $changed ]] || return 0
  if notify integrity --critical "Judge: server files changed outside a deploy" "Changed, added or removed since the last check:
$changed

If you did not change them (by hand, or with setup.sh or update.sh), find out who did before anything else.
On the server: sudo journalctl -t sudo -t sshd --since -1d"; then
    printf '%s\n' "$current" >"$file"
  fi
}

# Listening TCP and UDP sockets as "tcp 0.0.0.0:22". UDP sockets on ports a
# client gets on its own (32768 and up) come and go, so they are left out.
listening() {
  {
    ss -ltnH | awk '{ print "tcp " $4 }'
    ss -lunH | awk '{ n = split($4, p, ":"); if (p[n] + 0 < 32768) print "udp " $4 }'
  } | sort -u
}

check_ports() {
  local file=$STATE_DIR/ports current new
  current=$(listening)
  if [[ ! -f $file ]]; then
    printf '%s\n' "$current" >"$file"
    return 0
  fi
  # A deploy may add one; update.sh takes the new set when it succeeds.
  in_deploy_window && return 0
  new=$(comm -13 "$file" <(printf '%s\n' "$current") | sed '/^$/d')
  [[ -n $new ]] || return 0
  if notify ports --critical "Judge: a new port is listening on the server" "Not seen before:
$new

If no deploy or install explains it, find the program: sudo ss -ltnup"; then
    sort -u -o "$file" "$file" <(printf '%s\n' "$new")
  fi
}

signal_meaning() {
  case $1 in
    rate_limited) echo "Requests were refused by the rate limits: someone may be hammering the site." ;;
    turnstile_fail) echo "Visitors failed the bot check: a bot is probably trying to submit." ;;
    bad_origin) echo "Signed-in writes from other sites were refused: possibly a cross-site attack." ;;
    bearer_401) echo "Requests came with dead sign-in tokens: an app bug, or someone guessing tokens." ;;
    webhook_bad_secret) echo "Purchase webhooks came with a wrong secret: someone may be forging purchases, or the secret in RevenueCat changed." ;;
    webhook_apply_failed) echo "A purchase could not be applied. RevenueCat retries, but check the database." ;;
    entitlement_refused) echo "Finished verdicts were refused their credit settlement: a double-spend attempt, or a race with the sweep." ;;
    provider_rate) echo "The AI service is rate limiting the app; users get the quota message." ;;
    provider_down) echo "Calls to the AI service fail or time out; verdicts fail meanwhile." ;;
    ban)
      echo "fail2ban banned that many addresses: someone is trying SSH logins at scale."
      echo
      echo "On the server: sudo fail2ban-client status sshd"
      return
      ;;
  esac
  echo
  echo "On the server: journalctl -u verdict --since -15min | grep 'signal:$1'"
}

check_signals() {
  local counts n name limit var since=$((now - WINDOW_SEC))
  counts=$(
    {
      journalctl -q --no-pager -o cat -u verdict --since "@$since" | sed -n 's/^\[signal:\([a-z0-9_]*\)\].*/\1/p'
      journalctl -q --no-pager -o cat -u fail2ban --since "@$since" | sed -n '/\] Ban /s/.*/ban/p'
    } | sort | uniq -c
  )
  while read -r n name; do
    [[ -n $name ]] || continue
    var=ALERT_SIGNAL_${name^^}
    limit=${!var:-${SIGNAL_LIMITS[$name]-}}
    [[ $limit =~ ^[0-9]+$ ]] || limit=${SIGNAL_LIMITS[$name]-}
    if [[ -z $limit ]] || ((n < limit)); then continue; fi
    notify "signal-$name" "Judge: $name x$n in 5 minutes" "$name $n times in the last 5 minutes (limit $limit, $var in the env file).
$(signal_meaning "$name")" || true
  done <<<"$counts"
}

check_restarts() {
  local file=$STATE_DIR/restarts n last
  n=$(systemctl show verdict -p NRestarts --value 2>/dev/null || true)
  [[ $n =~ ^[0-9]+$ ]] || return 0
  last=$n
  if [[ -f $file ]]; then last=$(<"$file"); fi
  # The count starts over whenever the service is started by hand or a deploy.
  if ((n > last)); then
    notify restarts "Judge: the app restarted on its own" "The app stopped and systemd started it again ($((n - last)) times since the last check).

On the server: journalctl -u verdict -n 100" || true
  fi
  echo "$n" >"$file"
}

check_failed_units() {
  local file=$STATE_DIR/failed-units current new
  current=$(systemctl list-units --failed --plain --no-legend --no-pager 2>/dev/null | awk '{ print $1 }' | sort)
  new=$(comm -13 <(cat "$file" 2>/dev/null) <(printf '%s\n' "$current") | sed '/^$/d')
  if [[ -z $new ]] || notify failed-units "Judge: a service failed" "Failed:
$new

On the server: systemctl --failed, then journalctl -u <unit> -n 50"; then
    printf '%s\n' "$current" >"$file"
  fi
}

check_oom() {
  local lines
  lines=$(journal_new kernel _TRANSPORT=kernel | sed -n '/Killed process/p')
  [[ -n $lines ]] || return 0
  notify oom "Judge: a process was killed for lack of memory" "The kernel's out-of-memory killer struck:
$(clip <<<"$lines" | tail -n 3)

On the server: journalctl -k --since -1h; systemctl status verdict" || true
}

check_disk() {
  local mount use target seen=" "
  for mount in / "$DATA_DIR"; do
    [[ -d $mount ]] || continue
    read -r use target < <(df --output=pcent,target "$mount" | tail -n 1)
    use=${use%\%}
    [[ $seen == *" $target "* ]] && continue
    seen+="$target "
    ((use >= DISK_LIMIT)) || continue
    notify "disk-$target" "Judge: the disk at $target is $use% full" "The disk holding $mount is $use% full. Once it is full, the database and the backups stop working.

On the server: sudo du -xh --max-depth=2 $target | sort -h | tail -n 15" || true
  done
}

# Once an hour: the certificate Caddy serves for the site.
check_cert() {
  local file=$STATE_DIR/cert-checked last=0 host end days
  if [[ -f $file ]]; then last=$(<"$file"); fi
  ((now - last >= 3600)) || return 0
  echo "$now" >"$file"
  host=${NEXT_PUBLIC_SITE_URL-}
  host=${host#https://}
  host=${host%%/*}
  [[ -n $host ]] || return 0
  end=$(timeout 20 openssl s_client -connect 127.0.0.1:443 -servername "$host" </dev/null 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p') || true
  if [[ -z $end ]]; then
    notify cert "Judge: no certificate for $host" "Caddy did not present a certificate for $host on port 443.

On the server: systemctl status caddy; journalctl -u caddy -n 100" || true
    return 0
  fi
  days=$((($(date -d "$end" +%s) - now) / 86400))
  ((days < CERT_MIN_DAYS)) || return 0
  notify cert "Judge: the certificate for $host expires in $days days" "Caddy renews certificates about 30 days ahead, so renewal has been failing.

On the server: journalctl -u caddy -n 200 | grep -i -e acme -e certificate" || true
}

# The daily "Judge is fine" with the last 24 hours' numbers. $1: the checks
# that failed in this run.
heartbeat() {
  local file=$STATE_DIR/heartbeat-day today since=$((now - 86400))
  today=$(date +%F)
  [[ -n ${ALERT_EMAIL-}${NTFY_TOPIC-} ]] || return 0
  ((10#$(date +%H) >= 9)) || return 0
  [[ $(cat "$file" 2>/dev/null) != "$today" ]] || return 0

  local app n5 bans backup drill disk subject="Judge is fine"
  app=$(journalctl -q --no-pager -o cat -u verdict --since "@$since" | awk '
    /^\[premium\] verdict / && match($0, / outcome=[a-z_]+/) {
      o = substr($0, RSTART + 9, RLENGTH - 9)
      if (o == "ok" || o == "degraded" || o == "refused") judged++
      else if (o != "superseded") failed++
    }
    / tokens in=[0-9]+ out=[0-9]+/ {
      match($0, / in=[0-9]+/); tin += substr($0, RSTART + 4, RLENGTH - 4)
      match($0, / out=[0-9]+/); tout += substr($0, RSTART + 5, RLENGTH - 5)
    }
    /Scheduled restart job/ { restarts++ }
    /^\[signal:/ { signals++ }
    /^\[alert:/ { alerts++ }
    END {
      printf "Verdicts judged: %d (%d failed)\n", judged, failed
      printf "Tokens: %d in, %d out\n", tin, tout
      printf "Restarts after a crash: %d\n", restarts
      printf "Signal lines: %d, alert lines: %d\n", signals, alerts
    }')
  n5=0
  if [[ -r $ACCESS_LOG ]]; then
    n5=$(awk -v since="$since" '
      /"status":5[0-9][0-9][,}]/ && match($0, /"ts":[0-9.]+/) && substr($0, RSTART + 5, RLENGTH - 5) + 0 >= since { n++ }
      END { print n + 0 }' "$ACCESS_LOG")
  fi
  bans=$(journalctl -q --no-pager -o cat -u fail2ban --since "@$since" | awk '/\] Ban / { n++ } END { print n + 0 }')
  backup=$(journalctl -q --no-pager -o cat -u verdict-backup-upload --since "@$((since - 7200))" |
    sed -n -E '/^(Done:|ERROR:|Off-server copies are off)/p' | tail -n 1 | clip)
  drill=$(journalctl -q --no-pager -o cat -u verdict-restore-drill | sed -n '/^Restore drill/p' | tail -n 1 | clip)
  disk=$(df --output=pcent,target / "$DATA_DIR" 2>/dev/null |
    awk 'NR > 1 && !seen[$2]++ { printf "%s%s %s", sep, $2, $1; sep = ", " }') || true
  if [[ -n $1 ]]; then subject="Judge heartbeat: checks failing ($1)"; fi

  bash "$HERE/alert.sh" "$subject" "Last 24 hours on ${NEXT_PUBLIC_SITE_URL:-the server}:
$app
5xx responses: $n5
SSH addresses banned: $bans
Backup upload: ${backup:-no run in the last day}
Restore drill: ${drill:-none yet}
Disk use: $disk

This comes every morning. If a day passes without it, the alerts are not working: systemctl status verdict-watch.timer verdict-watch" ||
    return 0
  echo "$today" >"$file"
}

main() {
  exec 9>"$STATE_DIR/.lock"
  flock -w 50 9

  if [[ ${1-} == --rebaseline ]]; then
    integrity_now >"$STATE_DIR/integrity"
    listening >"$STATE_DIR/ports"
    log "Took the current files and listening ports as the expected ones."
    exit 0
  fi

  local check failing=()
  for check in check_app_alerts check_logins check_sudo check_integrity check_ports check_signals \
    check_restarts check_failed_units check_oom check_disk check_cert; do
    # In the background so that set -e holds inside the check, and one
    # broken check does not stop the others.
    "$check" &
    wait $! || failing+=("${check#check_}")
  done
  heartbeat "${failing[*]-}" &
  wait $! || failing+=(heartbeat)
  if ((${#failing[@]})); then
    echo "Checks that failed: ${failing[*]}" >&2
    exit 1
  fi
}

main "$@"
