#!/usr/bin/env bash
# Keeps this server in step with the address ranges Cloudflare publishes at
# https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
# Used when the site sits behind Cloudflare's proxy (CLOUDFLARE_PROXY=1 in
# /etc/verdict/verdict.env). update.sh runs it on every deploy and
# verdict-cloudflare-ips.timer once a week.
#
#   sudo bash /opt/verdict/repo/deploy/aws-lightsail/cloudflare-ips.sh [options]
#
# Without options it rewrites /etc/caddy/cloudflare-ips.caddy (the proxies
# Caddy trusts to name the visitor) and reloads Caddy if the list changed.
# With FIREWALL_CLOUDFLARE_ONLY=1 it also brings the ufw rules up to date:
# SSH open to everyone (every port sshd, ssh.socket or a current SSH session
# uses), ports 80 and 443 open to Cloudflare only. It never turns ufw on by
# itself; that is --enable-firewall, once.
#
#   --no-reload            write the list, but leave reloading Caddy to the caller
#   --no-firewall          skip the firewall step
#   --enable-firewall [M]  sync the rules, then turn ufw on for a trial: ufw
#                          turns itself off again after M minutes (default 10),
#                          and stays off after a restart, unless
#                          --confirm-firewall runs first
#   --confirm-firewall     keep ufw on, also after a restart
#
# If Cloudflare cannot be reached or sends something that is not a clean
# list of address ranges, the previous list stays in place and the script
# exits with an error; it never writes an empty or partial list.
set -euo pipefail

ENV_FILE=/etc/verdict/verdict.env
SNIPPET=/etc/caddy/cloudflare-ips.caddy
CADDYFILE=/etc/caddy/Caddyfile
UFW_CONF=/etc/ufw/ufw.conf
UFW_DEFAULTS=/etc/default/ufw
URL_V4=https://www.cloudflare.com/ips-v4
URL_V6=https://www.cloudflare.com/ips-v6
# Sanity bounds. Cloudflare has published 15 IPv4 and 7 IPv6 ranges for
# years; far fewer means a broken download, far more something else.
MIN_V4=5
MIN_V6=3
MAX_RANGES=200
UFW_TAG=verdict-cloudflare
SSH_TAG=verdict-ssh
ROLLBACK_UNIT=verdict-ufw-rollback
ROLLBACK_MINUTES_DEFAULT=10
WORKDIR=""

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# Prints the value of setting $1 from the env file, with surrounding quotes
# removed the way systemd's EnvironmentFile= does it (same as update.sh).
env_value() {
  local line value="" found
  local assign="^[[:space:]]*$1=(.*)\$"
  local dquoted='^"(.*)"$' squoted="^'(.*)'\$"
  [[ -f $ENV_FILE ]] || return 0
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ $assign ]]; then
      found=${BASH_REMATCH[1]}
      if [[ $found =~ $dquoted || $found =~ $squoted ]]; then
        found=${BASH_REMATCH[1]}
      fi
      value=$found
    fi
  done <"$ENV_FILE"
  printf '%s' "$value"
}

# True if setting $1 is switched on (1, true, yes or on).
setting_on() {
  local value
  value=$(env_value "$1")
  [[ ${value,,} =~ ^(1|true|yes|on)$ ]]
}

valid_ipv4() {
  local ip=$1 part
  [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  for part in ${ip//./ }; do
    ((10#$part <= 255)) || return 1
  done
}

# A plain IPv6 address in lower case (no zone, no embedded IPv4).
valid_ipv6() {
  local ip=$1 head tail part group count=0
  local -a groups
  [[ $ip =~ ^[0-9a-f:]+$ && $ip != *:::* ]] || return 1
  if [[ $ip == *::* ]]; then
    head=${ip%%::*}
    tail=${ip#*::}
    [[ $tail != *::* ]] || return 1
  else
    head=$ip
    tail=""
  fi
  for part in "$head" "$tail"; do
    [[ -n $part ]] || continue
    [[ $part != :* && $part != *: ]] || return 1
    IFS=: read -r -a groups <<<"$part"
    for group in "${groups[@]}"; do
      [[ $group =~ ^[0-9a-f]{1,4}$ ]] || return 1
      count=$((count + 1))
    done
  done
  if [[ $ip == *::* ]]; then ((count <= 7)); else ((count == 8)); fi
}

# A CIDR range of family $1 (4 or 6). Very short prefixes are refused: a
# list that trusted half the internet would let anyone name their own IP.
valid_cidr() {
  local family=$1 cidr=$2 addr len
  [[ $cidr == */* ]] || return 1
  addr=${cidr%/*}
  len=${cidr#*/}
  [[ $len =~ ^[0-9]{1,3}$ ]] || return 1
  len=$((10#$len))
  if [[ $family == 4 ]]; then
    valid_ipv4 "$addr" && ((len >= 8 && len <= 32))
  else
    valid_ipv6 "$addr" && ((len >= 16 && len <= 128))
  fi
}

# Downloads list $2 (family $1) and prints its ranges, one per line, in
# lower case. Fails without printing anything if any line is not a range of
# that family or the count is implausible.
fetch_ranges() {
  local family=$1 url=$2 body line min
  local -a ranges=()
  if ! body=$(curl -fsS --proto '=https' --tlsv1.2 --max-time 30 \
    --retry 3 --retry-delay 5 "$url"); then
    warn "Could not download $url."
    return 1
  fi
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line//[[:space:]]/}
    line=${line,,}
    [[ -n $line ]] || continue
    if ! valid_cidr "$family" "$line"; then
      warn "$url sent '${line:0:60}', which is not an IPv$family range."
      return 1
    fi
    ranges+=("$line")
  done <<<"$body"
  if [[ $family == 4 ]]; then min=$MIN_V4; else min=$MIN_V6; fi
  if ((${#ranges[@]} < min || ${#ranges[@]} > MAX_RANGES)); then
    warn "$url listed ${#ranges[@]} ranges; expected between $min and $MAX_RANGES."
    return 1
  fi
  printf '%s\n' "${ranges[@]}"
}

# Prints the ranges in the installed snippet, one per line.
installed_ranges() {
  [[ -f $SNIPPET ]] || return 0
  awk '$1 == "trusted_proxies" && $2 == "static" { for (i = 3; i <= NF; i++) print $i }' "$SNIPPET"
}

# Writes the Caddy snippet for ranges $2... into file $1.
write_snippet() {
  local out=$1
  shift
  {
    echo "# Cloudflare's address ranges, imported into the servers options of"
    echo "# $CADDYFILE. Written by cloudflare-ips.sh from"
    echo "# $URL_V4 and $URL_V6;"
    echo "# edits are overwritten."
    echo "trusted_proxies static $*"
  } >"$out"
}

# Checks snippet file $1 with caddy on a minimal config that imports it.
snippet_is_valid() {
  local snippet=$1 test_config
  test_config=$(dirname "$snippet")/Caddyfile.test
  cat >"$test_config" <<EOF
{
	servers {
		import $snippet
		client_ip_headers CF-Connecting-IP
	}
}

http://127.0.0.1:1 {
	respond "ok"
}
EOF
  caddy validate --adapter caddyfile --config "$test_config" >/dev/null 2>&1
}

caddy_uses_snippet() {
  [[ -f $CADDYFILE ]] && grep -qE "^[[:space:]]*import[[:space:]]+${SNIPPET}[[:space:]]*\$" "$CADDYFILE"
}

# Refreshes the snippet; reloads Caddy if $1 is 1 and the list changed.
# Returns 1 if no new list could be fetched (the previous one stays), and
# dies if there is no usable list at all.
update_snippet() {
  local reload=$1 new=$WORKDIR/cloudflare-ips.caddy v4 v6 fetched=1
  local -a ranges=()

  log "Cloudflare address ranges"
  if v4=$(fetch_ranges 4 "$URL_V4") && v6=$(fetch_ranges 6 "$URL_V6"); then
    mapfile -t ranges < <(printf '%s\n%s\n' "$v4" "$v6")
    write_snippet "$new" "${ranges[@]}"
    if ! snippet_is_valid "$new"; then
      warn "Caddy does not accept the new list."
      fetched=0
    fi
  else
    fetched=0
  fi

  if ((!fetched)); then
    [[ -f $SNIPPET ]] || die "There is no Cloudflare address list yet, and none could be fetched. Check that this server can reach www.cloudflare.com, then try again."
    warn "Keeping the previous list in $SNIPPET ($(installed_ranges | wc -l) ranges)."
    return 1
  fi

  if cmp -s "$new" "$SNIPPET"; then
    info "Unchanged: ${#ranges[@]} ranges in $SNIPPET."
    return 0
  fi

  install -d -m 755 "$(dirname "$SNIPPET")"
  if [[ -f $SNIPPET ]]; then cp -p "$SNIPPET" "$WORKDIR/previous.caddy"; fi
  install -m 644 -o root -g root "$new" "$SNIPPET.tmp"
  mv -f "$SNIPPET.tmp" "$SNIPPET"
  info "Wrote ${#ranges[@]} ranges to $SNIPPET."

  if [[ $reload == 1 ]] && caddy_uses_snippet && systemctl is-active --quiet caddy; then
    if ! caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1; then
      caddy validate --adapter caddyfile --config "$CADDYFILE" || true
      if [[ -f $WORKDIR/previous.caddy ]]; then
        install -m 644 -o root -g root "$WORKDIR/previous.caddy" "$SNIPPET"
      fi
      die "$CADDYFILE is invalid with the new list (see above); the previous list was put back."
    fi
    systemctl reload caddy
    info "Reloaded Caddy."
  fi
}

# Every port SSH may be reached on: 22; any Port in sshd's config; the
# ports of ssh.socket, which sshd -T does not know about when a drop-in
# changes them (and sshd -T can fail outright under socket activation); and
# the local port of every open SSH session, so nobody logged in right now
# is cut off.
ssh_ports() {
  {
    echo 22
    sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true
    systemctl show -p Listen --value ssh.socket 2>/dev/null |
      awk '{ n = split($1, a, ":"); print a[n] }' || true
    ss -Htnp state established 2>/dev/null |
      awk '/"sshd/ { n = split($3, a, ":"); print a[n] }' || true
  } | grep -xE '[0-9]{1,5}' | sort -nu
}

# The rules ufw has saved, as command lines without the leading "ufw"
# (works while ufw is off).
ufw_added() { ufw show added | sed -n 's/^ufw //p'; }

# True if the saved rules $2 have a rule with action $1 (a regex such as
# allow|limit) for SSH port $3, in any of the usual forms.
ssh_rule() {
  local app=""
  if [[ $3 == 22 ]]; then app="|OpenSSH|'OpenSSH'"; fi
  grep -qE "^($1)( in)? ($3(/tcp)?$app)( |\$)" <<<"$2"
}
ssh_allowed() { ssh_rule 'allow|limit' "$1" "$2"; }
ssh_denied() { ssh_rule 'deny|reject' "$1" "$2"; }

ufw_ipv6() { grep -qE '^IPV6=yes' "$UFW_DEFAULTS" 2>/dev/null; }

# True while an --enable-firewall trial waits for --confirm-firewall.
trial_pending() { systemctl is-active --quiet "$ROLLBACK_UNIT.timer"; }

# Prints the saved allow rules that may still let everyone reach port 80 or
# 443: no source address, and a port list or range that covers 80 or 443,
# an app profile (other than OpenSSH), or no port at all.
open_web_rules() {
  local rule rest spec item lo hi
  while IFS= read -r rule; do
    rule=${rule% comment \'*}
    [[ $rule =~ ^(allow|limit)(\ in)?\ (.*)$ ]] || continue
    rest=${BASH_REMATCH[3]}
    if [[ $rest =~ ^(on|from|to|proto)\  ]]; then
      if [[ $rest =~ (^|\ )from\ ([^ ]+) && ${BASH_REMATCH[2]} != any ]]; then continue; fi
      if [[ $rest =~ \ app\ (.+)$ ]]; then
        spec=${BASH_REMATCH[1]}
      elif [[ $rest =~ (^|\ )port\ ([^ ]+) ]]; then
        spec=${BASH_REMATCH[2]}
      else
        spec=1:65535
      fi
    else
      spec=$rest
    fi
    spec=${spec//\'/}
    if [[ $spec =~ ^[0-9,:]+(/(tcp|udp))?$ ]]; then
      spec=${spec%/*}
      for item in ${spec//,/ }; do
        [[ $item =~ ^[0-9]+(:[0-9]+)?$ ]] || continue
        lo=$((10#${item%:*}))
        hi=$((10#${item#*:}))
        if ((lo <= 80 && 80 <= hi || lo <= 443 && 443 <= hi)); then
          printf '%s\n' "$rule"
          break
        fi
      done
    elif [[ $spec != OpenSSH ]]; then
      printf '%s\n' "$rule"
    fi
  done < <(ufw_added)
}

# True if line $2 is one of the lines in $1 (ignoring case).
in_list() { grep -qixF -- "$2" <<<"$1"; }

# Brings the ufw rules in line with the installed list: SSH from anywhere
# (added first, never removed), then 80 and 443 from Cloudflare, and only
# then the removal of rules that open them to everyone, so a site behind an
# active ufw is never blocked halfway through.
sync_firewall() {
  local -a want=() have=() parts=()
  local rules rule range port want_list have_list added=0 removed=0 open
  log "Firewall (ufw): SSH from anywhere, web ports from Cloudflare only"
  command -v ufw >/dev/null || die "ufw is not installed: sudo apt-get install -y ufw"
  if trial_pending; then
    warn "A firewall trial (--enable-firewall) is waiting for --confirm-firewall; the rules are left as they are until it ends."
    return 0
  fi
  mapfile -t want < <(installed_ranges)
  ((${#want[@]} >= MIN_V4 + MIN_V6)) || die "$SNIPPET has no usable list; the firewall was not changed."
  if ! ufw_ipv6; then
    # ufw refuses IPv6 rules then ("IPv6 support not enabled").
    warn "IPV6 is not 'yes' in $UFW_DEFAULTS, so ufw cannot filter IPv6. Only the"
    warn "IPv4 ranges are added, and if the server has an IPv6 address it stays"
    warn "reachable directly over IPv6. Set IPV6=yes there and run this again."
    mapfile -t want < <(printf '%s\n' "${want[@]}" | grep -v ':')
  fi

  # 1. SSH, before anything else, unless a rule for that port exists already
  #    (allow or limit, in any form). Nothing below ever deletes these.
  rules=$(ufw_added)
  for port in $(ssh_ports); do
    if ssh_allowed "$rules" "$port"; then
      info "SSH port $port: already allowed."
    else
      ufw allow "$port/tcp" comment "$SSH_TAG" >/dev/null
      info "SSH port $port: allowed from anywhere."
    fi
    if ssh_denied "$rules" "$port"; then
      warn "A deny or reject rule for SSH port $port may win over the allow rule;"
      warn "delete it (sudo ufw status numbered, then sudo ufw delete N)."
    fi
  done

  # 2. Cloudflare ranges: add the new ones, then drop the ones Cloudflare no
  #    longer lists.
  rules=$(ufw_added)
  mapfile -t have < <(sed -n \
    "s|^allow from \([^ ]*\) to any port 80,443 proto tcp comment '$UFW_TAG'\$|\1|p" <<<"$rules")
  if ! ufw_ipv6; then
    mapfile -t have < <(printf '%s\n' "${have[@]}" | grep -v ':')
  fi
  want_list=$(printf '%s\n' "${want[@]}")
  have_list=$(printf '%s\n' "${have[@]}")
  for range in "${want[@]}"; do
    if ! in_list "$have_list" "$range"; then
      ufw allow from "$range" to any port 80,443 proto tcp comment "$UFW_TAG" >/dev/null
      added=$((added + 1))
    fi
  done
  for range in "${have[@]}"; do
    [[ -n $range ]] || continue
    if ! in_list "$want_list" "$range"; then
      ufw delete allow from "$range" to any port 80,443 proto tcp >/dev/null
      removed=$((removed + 1))
    fi
  done
  info "Cloudflare rules: ${#want[@]} ranges ($added added, $removed removed)."

  # 3. Everything else incoming is blocked.
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null

  # 4. Rules that open 80/443 to everyone would defeat the point.
  rules=$(ufw_added)
  while IFS= read -r rule; do
    [[ -n $rule ]] || continue
    rule=${rule% comment *}
    read -r -a parts <<<"$rule"
    ufw delete "${parts[@]}" >/dev/null
    info "Removed the rule '$rule' (web ports open to everyone)."
  done < <(grep -E "^allow( in)? (80|443|80,443|443,80)(/tcp|/udp)?( comment '[^']*')?\$" <<<"$rules" || true)
  open=$(open_web_rules)
  if [[ -n $open ]]; then
    warn "These rules may still let everyone reach port 80 or 443. Check them,"
    warn "and delete any that do (sudo ufw status numbered, then sudo ufw delete N):"
    while IFS= read -r rule; do warn "  ufw $rule"; done <<<"$open"
  fi

  if [[ $(ufw status) == "Status: active"* ]]; then
    info "ufw is on; the rules are in effect."
  else
    info "ufw is off; the rules are saved but not in effect. To turn it on safely:"
    info "  sudo bash ${BASH_SOURCE[0]} --enable-firewall"
  fi
}

enable_firewall() {
  local minutes=$1 ufw_bin rules port
  ufw_bin=$(command -v ufw) || die "ufw is not installed: sudo apt-get install -y ufw"
  if trial_pending; then
    die "A firewall trial is already running. Keep it with --confirm-firewall, or end it now with: sudo systemctl stop $ROLLBACK_UNIT.timer; sudo ufw disable"
  fi
  sync_firewall
  rules=$(ufw_added)
  for port in $(ssh_ports); do
    ssh_allowed "$rules" "$port" || die "No ufw rule allows SSH on port $port; ufw was not turned on."
    if ssh_denied "$rules" "$port"; then
      die "A ufw rule denies SSH on port $port and may win over the allow rule. Delete it first (sudo ufw status numbered, then sudo ufw delete N); ufw was not turned on."
    fi
  done

  log "Turning ufw on, with an automatic turn-off in $minutes minutes"
  # Unloads a leftover unit from an earlier trial, so the name is free.
  systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
  systemctl reset-failed "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" >/dev/null 2>&1 || true
  # ufw-init force-stop: works whatever ufw.conf says (see below).
  systemd-run --quiet --unit="$ROLLBACK_UNIT" --on-active="${minutes}min" \
    --description="Turn ufw off unless the Cloudflare-only firewall was confirmed" \
    "$ufw_bin" --force disable
  "$ufw_bin" --force enable >/dev/null
  # ufw enable also saved ENABLED=yes, so a restart within the trial would
  # bring ufw back on with the turn-off above gone. The rules stay in effect
  # now; after a restart ufw comes up off until --confirm-firewall.
  sed -i 's/^ENABLED=.*/ENABLED=no/' "$UFW_CONF"
  "$ufw_bin" status verbose
  cat <<EOF

    ufw is ON. It turns itself OFF again in $minutes minutes, or if the server
    restarts, unless you confirm. Keep this SSH window open. Check in a NEW
    SSH window that you can still log in, and in a browser that the site
    still loads. If both work:

      sudo bash ${BASH_SOURCE[0]} --confirm-firewall

    If you cannot log in, do nothing: ufw turns off on its own.
EOF
}

confirm_firewall() {
  local ufw_bin
  ufw_bin=$(command -v ufw) || die "ufw is not installed: sudo apt-get install -y ufw"
  if [[ $("$ufw_bin" status) != "Status: active"* ]]; then
    systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
    die "ufw is off: the trial ended (the automatic turn-off ran, or the server restarted). Start a new one with: sudo bash ${BASH_SOURCE[0]} --enable-firewall"
  fi
  if trial_pending; then
    systemctl stop "$ROLLBACK_UNIT.timer"
    info "The automatic turn-off is cancelled."
  else
    info "No automatic turn-off is pending."
  fi
  # Saves ENABLED=yes, so ufw comes back on after a restart. The rules in
  # effect stay as they are.
  "$ufw_bin" --force enable >/dev/null
  info "Confirmed: ufw stays on, also after a restart."
  "$ufw_bin" status verbose
}

main() {
  local reload=1 firewall=1 mode=sync minutes=$ROLLBACK_MINUTES_DEFAULT status=0
  while (($#)); do
    case $1 in
      --no-reload) reload=0 ;;
      --no-firewall) firewall=0 ;;
      --enable-firewall)
        mode=enable
        if [[ ${2-} =~ ^[0-9]+$ ]]; then
          minutes=$((10#$2))
          shift
        fi
        ((minutes >= 2 && minutes <= 120)) || die "The minutes for --enable-firewall must be between 2 and 120."
        ;;
      --confirm-firewall) mode=confirm ;;
      -h | --help)
        awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
        exit 0
        ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done
  [[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash $0"

  if [[ $mode == confirm ]]; then
    confirm_firewall
    return
  fi
  if [[ $mode == enable ]]; then
    setting_on CLOUDFLARE_PROXY ||
      die "CLOUDFLARE_PROXY=1 is not set in $ENV_FILE. Without Cloudflare's proxy in front, this firewall would lock every visitor out."
    setting_on FIREWALL_CLOUDFLARE_ONLY ||
      die "Set FIREWALL_CLOUDFLARE_ONLY=1 in $ENV_FILE first, so the weekly refresh keeps the rules up to date."
  fi

  exec 8>/run/lock/verdict-cloudflare-ips.lock
  flock -w 120 8 || die "Another run of this script did not finish within 2 minutes."
  WORKDIR=$(mktemp -d)
  trap 'rm -rf -- "$WORKDIR"' EXIT

  update_snippet "$reload" || status=1

  if [[ $mode == enable ]]; then
    enable_firewall "$minutes"
  elif ((firewall)) && setting_on FIREWALL_CLOUDFLARE_ONLY; then
    if setting_on CLOUDFLARE_PROXY; then
      sync_firewall
    else
      warn "FIREWALL_CLOUDFLARE_ONLY=1 needs CLOUDFLARE_PROXY=1; the firewall was left alone."
    fi
  fi
  return "$status"
}

main "$@"
