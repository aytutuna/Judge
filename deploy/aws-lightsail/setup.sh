#!/usr/bin/env bash
# One-time setup of Verdict on a fresh AWS Lightsail Ubuntu 24.04 LTS
# instance. Run it as the default "ubuntu" user from the browser SSH window:
#
#   curl -fsSL https://raw.githubusercontent.com/aytutuna/Verdict/main/deploy/aws-lightsail/setup.sh -o setup.sh && sudo bash setup.sh
#
# Options:
#   --branch NAME    deploy another branch (default: main)
#   --repo URL       clone another repository (default: the Verdict repo)
#   --reconfigure    ask for the API key and site address again
#
# Safe to run again: finished steps are skipped and existing settings kept.
# If it stops with an error, fix the cause (if any) and run the same command.
# It installs a swap file, Node.js 24, Caddy and automatic security updates,
# creates the "verdict" user, clones the code to /opt/verdict/repo (owned by
# root, so the app user cannot change what root runs), writes
# /etc/verdict/verdict.env, then builds and starts the site with update.sh.
set -euo pipefail

REPO_URL_DEFAULT=https://github.com/aytutuna/Verdict.git
BRANCH_DEFAULT=main
NODE_MAJOR=24
APP_USER=verdict
APP_DIR=/opt/verdict
REPO_DIR=$APP_DIR/repo
DATA_DIR=/var/lib/verdict
ENV_DIR=/etc/verdict
ENV_FILE=$ENV_DIR/verdict.env
SWAPFILE=/swapfile
# If a build runs out of memory, run setup.sh again with a bigger swap file:
#   sudo SWAP_SIZE=3G bash /opt/verdict/repo/deploy/aws-lightsail/setup.sh
# Without SWAP_SIZE, an existing swap file keeps its size.
SWAP_SIZE_DEFAULT=2G
# How long apt waits for another apt/dpkg run (first-boot updates) to finish.
APT_LOCK_TIMEOUT_SEC=600

export DEBIAN_FRONTEND=noninteractive
# Ubuntu's needrestart would otherwise stop apt with an interactive menu.
export NEEDRESTART_MODE=a

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# On a new instance, cloud-init and apt's daily jobs hold the dpkg lock for
# the first minutes. Waits for them instead of failing on "Could not get lock".
wait_for_apt() {
  local waited=0
  while command -v fuser >/dev/null &&
    fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1; do
    if ((waited == 0)); then info "Waiting for another apt run (system updates) to finish..."; fi
    ((waited < APT_LOCK_TIMEOUT_SEC)) ||
      die "apt has been busy for $((APT_LOCK_TIMEOUT_SEC / 60)) minutes. Wait a little, then run the same command again."
    sleep 5
    waited=$((waited + 5))
  done
}

apt_get() {
  wait_for_apt
  apt-get -o "DPkg::Lock::Timeout=$APT_LOCK_TIMEOUT_SEC" "$@"
}

apt_install() { apt_get install -y -q --no-install-recommends "$@"; }

# Makes every apt-get in this run (also the ones inside NodeSource's setup
# script) wait for the dpkg lock, and lets cloud-init finish first.
prepare_apt() {
  log "Waiting for first-boot jobs to finish"
  if command -v cloud-init >/dev/null; then
    timeout "$APT_LOCK_TIMEOUT_SEC" cloud-init status --wait >/dev/null 2>&1 || true
  fi
  APT_LOCK_CONF=$(mktemp)
  # shellcheck disable=SC2064 # expand the path now
  trap "rm -f -- '$APT_LOCK_CONF'" EXIT
  printf 'DPkg::Lock::Timeout "%s";\n' "$APT_LOCK_TIMEOUT_SEC" >"$APT_LOCK_CONF"
  chmod 644 "$APT_LOCK_CONF"
  # Read in addition to /etc/apt/apt.conf and apt.conf.d, not instead of them.
  export APT_CONFIG=$APT_LOCK_CONF
  wait_for_apt
  info "Done."
}

valid_ipv4() {
  local ip=$1 part
  [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  for part in ${ip//./ }; do
    ((10#$part <= 255)) || return 1
  done
}

valid_host() {
  [[ $1 =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}

# The instance's public IPv4: from the instance metadata service (IMDSv2,
# which Lightsail's Ubuntu 24 image enforces), else from an echo service.
detect_ipv4() {
  local token ip=""
  if token=$(curl -fsS -m 3 -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null); then
    ip=$(curl -fsS -m 3 -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
  fi
  if ! valid_ipv4 "$ip"; then
    ip=$(curl -fsS -4 -m 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
  fi
  if valid_ipv4 "$ip"; then printf '%s' "$ip"; fi
}

# Sets KEY=value in the env file, replacing an existing line or appending.
# The value travels through the environment, never through argv.
set_env() {
  local tmp
  tmp=$(mktemp "$ENV_DIR/.verdict.env.XXXXXX")
  ENV_KEY=$1 ENV_VAL=$2 awk '
    BEGIN { k = ENVIRON["ENV_KEY"]; v = ENVIRON["ENV_VAL"] }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" >"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

# Settings added after the first release of this script. Appended to an older
# env file only if the key is not there at all (not even commented out).
add_missing_settings() {
  if ! grep -qE '^[#[:space:]]*RATE_LIMIT_DB=' "$ENV_FILE"; then
    set_env RATE_LIMIT_DB "file:/run/verdict/ratelimit.db"
    info "Added RATE_LIMIT_DB (rate limits now survive app restarts)."
  fi
}

setup_swap() {
  log "Swap file (so the build fits in 512 MB of RAM)"
  local size=${SWAP_SIZE:-} want have=0 active=0
  if [[ -f $SWAPFILE ]]; then have=$(stat -c %s "$SWAPFILE"); fi
  if swapon --show=NAME --noheadings | grep -qx "$SWAPFILE"; then active=1; fi
  if [[ -z $size ]]; then
    if ((active)); then size=$have; else size=$SWAP_SIZE_DEFAULT; fi
  fi
  want=$(numfmt --from=iec "$size") || die "SWAP_SIZE must be a size such as 2G or 3G, got '$size'."
  # Whole MiB, so the dd fallback writes exactly the same size.
  want=$((want / 1048576 * 1048576))
  ((want >= 268435456)) || die "SWAP_SIZE must be at least 256M, got '$size'."
  if ((active && have == want)); then
    info "Already active ($((have / 1048576)) MB)."
  else
    if ((have != want)); then
      if ((active)); then
        info "Resizing it from $((have / 1048576)) MB to $((want / 1048576)) MB."
        swapoff "$SWAPFILE"
      fi
      rm -f "$SWAPFILE"
      fallocate -l "$want" "$SWAPFILE" ||
        dd if=/dev/zero of="$SWAPFILE" bs=1M count="$((want / 1048576))" status=none
    fi
    chmod 600 "$SWAPFILE"
    # A file left by an interrupted run may not be formatted as swap yet.
    if [[ $(blkid -p -o value -s TYPE "$SWAPFILE" 2>/dev/null || true) != swap ]]; then
      mkswap "$SWAPFILE" >/dev/null
    fi
    swapon "$SWAPFILE"
    info "Enabled ($((want / 1048576)) MB)."
  fi
  if ! grep -qE "^${SWAPFILE}[[:space:]]" /etc/fstab; then
    echo "$SWAPFILE none swap sw 0 0" >>/etc/fstab
  fi
}

install_packages() {
  log "System packages"
  apt_get update -q
  apt_install ca-certificates curl gnupg git openssl sqlite3 unattended-upgrades \
    debian-keyring debian-archive-keyring apt-transport-https
}

install_node() {
  log "Node.js $NODE_MAJOR (NodeSource)"
  if command -v node >/dev/null && [[ $(node -v) == "v$NODE_MAJOR."* ]]; then
    info "Already installed: $(node -v)"
    return
  fi
  local script
  script=$(mktemp)
  curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" -o "$script"
  wait_for_apt
  bash "$script"
  rm -f "$script"
  apt_install nodejs
  [[ $(node -v) == "v$NODE_MAJOR."* ]] || die "Expected Node.js $NODE_MAJOR, got $(node -v)."
  info "Installed $(node -v), npm $(npm -v)"
}

install_caddy() {
  log "Caddy web server (official apt repository)"
  if dpkg -s caddy >/dev/null 2>&1; then
    info "Already installed: $(caddy version | cut -d' ' -f1)"
    return
  fi
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt_get update -q
  apt_install caddy
  info "Installed $(caddy version | cut -d' ' -f1)"
}

enable_auto_updates() {
  log "Automatic security updates"
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  systemctl enable --now --quiet unattended-upgrades apt-daily.timer apt-daily-upgrade.timer
  info "Enabled (unattended-upgrades)."
}

create_user_and_dirs() {
  log "App user and directories"
  if id "$APP_USER" >/dev/null 2>&1; then
    info "User $APP_USER exists."
  else
    useradd --system --user-group --home-dir "$APP_DIR" --no-create-home \
      --shell /usr/sbin/nologin "$APP_USER"
    info "Created system user $APP_USER (no login shell)."
  fi
  # /opt/verdict and the code in it belong to root: root runs update.sh and
  # installs the systemd units from there. The app user only owns the build
  # directories, its data and its build cache.
  install -d -m 755 -o root -g root "$APP_DIR"
  install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/releases"
  install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$DATA_DIR" "$DATA_DIR/backups"
  install -d -m 700 -o root -g root "$ENV_DIR"
}

clone_repo() {
  local repo_url=$1 branch=$2
  log "Code in $REPO_DIR"
  if [[ -e $REPO_DIR && $(stat -c %U "$REPO_DIR") != root ]] ||
    [[ -e $REPO_DIR/.git && $(stat -c %U "$REPO_DIR/.git") != root ]]; then
    # An older setup let the app user own the checkout. Clone it afresh as
    # root rather than trust files that user could have changed.
    info "Replacing the checkout owned by $APP_USER with a fresh one owned by root."
    rm -rf -- "$REPO_DIR"
  fi
  if [[ -d $REPO_DIR/.git ]]; then
    git -C "$REPO_DIR" remote set-url origin "$repo_url"
    info "Already cloned; update.sh fetches the latest $branch below."
  else
    rm -rf -- "$REPO_DIR"
    git clone --branch "$branch" "$repo_url" "$REPO_DIR" ||
      die "Could not clone $repo_url (branch $branch). Is the repository public and the branch pushed?"
  fi
}

ask_site_host() {
  local ip=$1 fallback="" host
  if [[ -n $ip ]]; then fallback=${ip//./-}.sslip.io; fi
  {
    echo
    echo "Site address. Two choices:"
    echo "  - Your own domain (e.g. verdict.example.org). Point its DNS A record at"
    echo "    this server's static IP first; HTTPS starts working once DNS has updated."
    if [[ -n $fallback ]]; then
      echo "  - No domain: press Enter to use $fallback,"
      echo "    a free name that always points at $ip."
    fi
  } >&2
  while true; do
    if [[ -n $fallback ]]; then
      read -r -p "Domain name [$fallback]: " host
      host=${host:-$fallback}
    else
      read -r -p "Domain name: " host
    fi
    host=${host,,}
    host=${host#https://}
    host=${host#http://}
    host=${host%%/*}
    if valid_host "$host"; then break; fi
    echo "That is not a valid host name. Type just the name, e.g. verdict.example.org" >&2
  done
  if [[ -n $ip && $host != *.sslip.io ]]; then
    if getent ahostsv4 "$host" | awk '{ print $1 }' | grep -qx "$ip"; then
      info "DNS for $host points at $ip." >&2
    else
      warn "DNS for $host does not point at $ip yet. The site will get its HTTPS" >&2
      warn "certificate a few minutes after it does; Caddy keeps retrying on its own." >&2
    fi
  fi
  printf '%s' "$host"
}

ask_api_key() {
  local key
  echo >&2
  echo "Anthropic API key (from console.anthropic.com -> API keys). It is not shown while you type or paste." >&2
  while true; do
    read -r -s -p "API key: " key
    echo >&2
    if [[ $key =~ ^[A-Za-z0-9_-]{20,}$ ]]; then break; fi
    echo "That does not look like an API key (letters, digits, - and _ only). Try again." >&2
  done
  printf '%s' "$key"
}

write_env_file() {
  local reconfigure=$1 ip host key
  log "Settings in $ENV_FILE"
  if [[ -f $ENV_FILE && $reconfigure -eq 0 && -n $(get_env ANTHROPIC_API_KEY) && -n $(get_env NEXT_PUBLIC_SITE_URL) ]]; then
    info "Keeping existing settings (run with --reconfigure to enter them again)."
    add_missing_settings
    return
  fi
  [[ -t 0 ]] || die "setup.sh asks questions; run it in a terminal: sudo bash setup.sh"

  ip=$(detect_ipv4)
  if [[ -n $ip ]]; then
    info "This server's public IPv4 address: $ip"
    info "It must be the STATIC IP you attached in the Lightsail console (Networking tab)."
    info "If you have not attached one yet, press Ctrl+C, do that, and run setup.sh again."
  else
    warn "Could not detect this server's public IP address."
  fi
  host=$(ask_site_host "$ip")

  if [[ ! -f $ENV_FILE ]]; then
    local tmp
    tmp=$(mktemp "$ENV_DIR/.verdict.env.XXXXXX")
    cat >"$tmp" <<EOF
# Verdict settings. Read by systemd (verdict.service) at start and by
# update.sh at build time. Format: KEY=value, one per line, no quotes needed.
#
# After editing (sudo nano $ENV_FILE):
#   - NEXT_PUBLIC_* or CONTACT_EMAIL changed: sudo verdict-update --force
#     (they are baked into the pages at build time)
#   - anything else:                          sudo systemctl restart verdict

# --- Model (required) ---------------------------------------------------------
ANTHROPIC_API_KEY=

# --- Server -------------------------------------------------------------------
NODE_ENV=production
# The app listens on 127.0.0.1:3000 only (fixed in verdict.service); Caddy
# forwards the public HTTPS traffic to it.
HOSTNAME=127.0.0.1
PORT=3000

# --- Storage: a SQLite file on this server's disk -----------------------------
DATABASE_URL=file:$DATA_DIR/verdict.db

# --- Abuse and cost limits ----------------------------------------------------
# Rate limits are counted in the app's memory and also written to this file,
# so app restarts, crashes and deploys keep them. /run is cleared when the
# server reboots, and the limits start over then; the spend limit in the
# Anthropic Console is the only hard cap. Exactly ONE app process may run:
# never start a second copy of the app on this server.
RATE_LIMIT_DB=file:/run/verdict/ratelimit.db
RATE_LIMIT_SALT=$(openssl rand -hex 32)
# Site-wide verdicts per UTC day. 0 pauses the site.
DAILY_VERDICT_CAP=1000

# --- Public site (build time) -------------------------------------------------
NEXT_PUBLIC_SITE_URL=
# Inbox shown on /privacy for questions and removal requests. Type it right
# after the = sign, e.g. CONTACT_EMAIL=you@yourdomain.org (empty = not shown).
CONTACT_EMAIL=

# --- Bot check, optional (Cloudflare Turnstile) ---------------------------------
# Add this site's host name to a Turnstile widget, then paste both keys right
# after the = signs. Empty = no bot check.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# --- Accounts and Premium, optional (off while BETTER_AUTH_SECRET is unset) ----
# Needs a real domain in NEXT_PUBLIC_SITE_URL for Google, Apple and email
# sign-in. See "Accounts and Premium" in the README for every setting.
# BETTER_AUTH_SECRET=   (openssl rand -base64 32)
# BETTER_AUTH_URL=https://your.domain
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# APPLE_CLIENT_ID=
# APPLE_TEAM_ID=
# APPLE_KEY_ID=
# APPLE_PRIVATE_KEY_BASE64=
# RESEND_API_KEY=
# EMAIL_FROM=Verdict <signin@your.domain>
# PREMIUM_DAILY_CAP=500
EOF
    chmod 600 "$tmp"
    mv -f "$tmp" "$ENV_FILE"
  fi
  chown root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_env NEXT_PUBLIC_SITE_URL "https://$host"

  local replace_key=1 answer
  if [[ -n $(get_env ANTHROPIC_API_KEY) ]]; then
    replace_key=0
    if [[ $reconfigure -eq 1 ]]; then
      read -r -p "Replace the saved Anthropic API key? [y/N]: " answer
      if [[ $answer == [yY]* ]]; then replace_key=1; fi
    fi
  fi
  if [[ $replace_key -eq 1 ]]; then
    key=$(ask_api_key)
    set_env ANTHROPIC_API_KEY "$key"
    key=""
  fi
  add_missing_settings
  info "Saved settings (readable by root only)."
}

install_shortcuts() {
  log "Shortcut commands"
  local name script
  for name in update restore; do
    script=$REPO_DIR/deploy/aws-lightsail/$name.sh
    printf '#!/bin/sh\nexec bash %s "$@"\n' "$script" >/usr/local/sbin/verdict-$name
    chmod 755 /usr/local/sbin/verdict-$name
  done
  info "sudo verdict-update  - deploy the latest pushed code"
  info "sudo verdict-restore - restore the database from a backup"
}

main() {
  local repo_url=$REPO_URL_DEFAULT branch=$BRANCH_DEFAULT reconfigure=0
  while (($#)); do
    case $1 in
      --branch)
        [[ $# -ge 2 ]] || die "--branch needs a branch name."
        branch=$2
        shift
        ;;
      --repo)
        [[ $# -ge 2 ]] || die "--repo needs a URL."
        repo_url=$2
        shift
        ;;
      --reconfigure) reconfigure=1 ;;
      -h | --help)
        awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
        exit 0
        ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done

  [[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash setup.sh"
  if ! grep -qx 'VERSION_ID="24.04"' /etc/os-release; then
    warn "This script is written for Ubuntu 24.04 LTS; continuing anyway."
  fi

  setup_swap
  prepare_apt
  install_packages
  install_node
  install_caddy
  enable_auto_updates
  create_user_and_dirs
  clone_repo "$repo_url" "$branch"
  write_env_file "$reconfigure"
  install_shortcuts

  log "First build and start (update.sh)"
  bash "$REPO_DIR/deploy/aws-lightsail/update.sh" --force --branch "$branch"

  local url
  url=$(get_env NEXT_PUBLIC_SITE_URL)
  cat <<EOF

==> All set. Your site: $url

    The HTTPS certificate is requested the first time Caddy starts. If the page
    does not load yet, wait a minute and reload. Problems with the certificate:
      sudo journalctl -u caddy -n 50

    Everyday commands:
      sudo verdict-update                 deploy what you pushed to GitHub
      sudo journalctl -u verdict -f       live app logs (Ctrl+C to stop)
      sudo systemctl restart verdict      restart the app
      sudo nano $ENV_FILE   edit settings
      sudo verdict-restore                list or restore database backups

    If the SSH window says "System restart required", run: sudo reboot
    (everything starts again on its own).
EOF
}

main "$@"
