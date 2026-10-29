#!/usr/bin/env bash
# Deploys the latest commit of the deployed branch (default: the branch the
# server is already on). Run on the server after every git push:
#
#   sudo verdict-update            # same as the line below
#   sudo bash /opt/verdict/repo/deploy/aws-lightsail/update.sh [--force] [--branch NAME]
#
#   --force          rebuild even if that commit is already running (needed
#                    after editing NEXT_PUBLIC_* or CONTACT_EMAIL in the env file)
#   --branch NAME    switch the server to another branch
#
# The new commit is built in a fresh directory under /opt/verdict/releases
# while the running site keeps serving the old one. Only a successful build is
# switched in and restarted; if the restarted site fails its health check,
# the previous release, its systemd units and its Caddyfile are put back
# automatically.
#
# Trust boundary: npm ci and next build run dependency code as the verdict
# user, so nothing root installs or runs may come from a place that user can
# write. The git checkout in /opt/verdict/repo (and this script in it) is
# owned by root; the systemd units and the Caddyfile are copied from there,
# never from the release directory the build ran in.
#
# Web server settings in /etc/verdict/verdict.env (all optional; after a
# change run sudo verdict-update --force):
#   SITE_ALIASES       other names of the site, e.g. www.example.org; each
#                      redirects to the address in NEXT_PUBLIC_SITE_URL
#   LEGACY_HOSTS       old addresses that redirect the same way, e.g. the
#                      sslip.io name (only while visitors can reach this
#                      server directly, not with FIREWALL_CLOUDFLARE_ONLY=1)
#   CLOUDFLARE_PROXY=1 the site is behind Cloudflare's proxy: trust
#                      Cloudflare (and only Cloudflare) to name the visitor,
#                      and refresh its address list weekly (cloudflare-ips.sh)
set -euo pipefail

APP_USER=verdict
APP_DIR=/opt/verdict
REPO_DIR=$APP_DIR/repo
RELEASES_DIR=$APP_DIR/releases
CURRENT_LINK=$APP_DIR/current
ENV_FILE=/etc/verdict/verdict.env
DEPLOY_SRC=$REPO_DIR/deploy/aws-lightsail
# HOME and npm cache for the build user (/opt/verdict itself is root-owned).
BUILD_HOME=/var/cache/verdict-build
CADDYFILE=/etc/caddy/Caddyfile
ACCESS_LOG=/var/log/caddy/access.log
# The watcher (watch.sh) takes changes to units, the Caddyfile and the live
# release as a deploy's while deploy-at in here is under 30 minutes old.
ALERT_DIR=/var/lib/verdict-alerts
UNITS=(verdict.service verdict-backup.service verdict-backup.timer verdict-backup-upload.service verdict-errors.service verdict-errors.timer
  verdict-watch.service verdict-watch.timer verdict-restore-drill.service verdict-restore-drill.timer)
# Installed only while CLOUDFLARE_PROXY=1.
CF_UNITS=(verdict-cloudflare-ips.service verdict-cloudflare-ips.timer)
CF_SNIPPET=/etc/caddy/cloudflare-ips.caddy
HEALTH_URL=http://127.0.0.1:3000/api/health
HEALTH_TIMEOUT_SEC=120
KEEP_RELEASES=3
# V8 heap for npm ci and next build. The instance has 512 MB of RAM, so this
# relies on the swap file setup.sh creates.
BUILD_HEAP_MB=1536
MIN_FREE_DISK_MB=1500

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# Runs a command as the app user from a directory it can read.
as_app() { (cd "$APP_DIR" && runuser -u "$APP_USER" -- "$@"); }

# Prints the env file's KEY=value lines, with surrounding quotes removed the
# way systemd's EnvironmentFile= does it. Comments and blank lines are skipped.
env_lines() {
  local line key value
  local assign='^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$'
  local dquoted='^"(.*)"$' squoted="^'(.*)'\$"
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ $assign ]]; then
      key=${BASH_REMATCH[1]}
      value=${BASH_REMATCH[2]}
      if [[ $value =~ $dquoted || $value =~ $squoted ]]; then
        value=${BASH_REMATCH[1]}
      fi
      printf '%s=%s\n' "$key" "$value"
    fi
  done <"$ENV_FILE"
}

env_value() { env_lines | sed -n "s/^$1=//p" | tail -n 1; }

# Host name for Caddy, from NEXT_PUBLIC_SITE_URL.
site_host() {
  local url host
  url=$(env_value NEXT_PUBLIC_SITE_URL)
  host=${url#https://}
  host=${host#http://}
  host=${host%%/*}
  host=${host,,}
  if [[ ! $host =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
    die "NEXT_PUBLIC_SITE_URL in $ENV_FILE must be https://<your host name>, got '${url}'."
  fi
  printf '%s' "$host"
}

# True if CLOUDFLARE_PROXY is on in the env file.
cloudflare_proxy() {
  local value
  value=$(env_value CLOUDFLARE_PROXY)
  case ${value,,} in
    1 | true | yes | on) return 0 ;;
    "" | 0 | false | no | off) return 1 ;;
    *) die "CLOUDFLARE_PROXY in $ENV_FILE must be 1 (on) or 0 (off), got '$value'." ;;
  esac
}

# True if ufw is on with cloudflare-ips.sh's rules, i.e. only Cloudflare can
# reach ports 80 and 443.
cloudflare_firewall_on() {
  local status
  command -v ufw >/dev/null || return 1
  status=$(ufw status 2>/dev/null) || return 1
  [[ $status == "Status: active"* && $status == *verdict-cloudflare* ]]
}

# Prints the host names in setting $1 (separated by spaces or commas), one
# per line, skipping the main host $2 and the names in $3 (one per line).
redirect_hosts() {
  local name=$1 main=$2 seen=$3 raw host
  local -a hosts
  raw=$(env_value "$name")
  IFS=', ' read -r -a hosts <<<"$raw"
  for host in "${hosts[@]}"; do
    [[ -n $host ]] || continue
    host=${host,,}
    host=${host#https://}
    host=${host#http://}
    host=${host%%/*}
    [[ $host =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] ||
      die "$name in $ENV_FILE must list host names such as www.example.org, got '$host'."
    if [[ $host == "$main" ]] || grep -qxF -- "$host" <<<"$seen"; then continue; fi
    seen+=$'\n'$host
    printf '%s\n' "$host"
  done
}

# Prints a site block that sends host $1 to https://$2, keeping the path.
redirect_block() {
  printf '%s {\n\tredir https://%s{uri} permanent\n}\n' "$1" "$2"
}

# The env file values the build may see: the ones baked into the pages.
# Secrets (ANTHROPIC_API_KEY, RATE_LIMIT_SALT, TURNSTILE_SECRET_KEY, ...) are
# only read at run time, by systemd, and never reach npm or its packages.
build_env_lines() {
  env_lines | grep -E '^(NEXT_PUBLIC_[A-Za-z0-9_]*|CONTACT_EMAIL)=' || true
}

# Runs a build step as the app user in a clean environment. With
# --with-build-env it also gets build_env_lines (public values only, so it is
# fine that they are passed as arguments to env).
build_step() {
  local release=$1 with_env=0 kv
  shift
  if [[ ${1-} == --with-build-env ]]; then
    with_env=1
    shift
  fi
  local -a vars=(
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    "HOME=$BUILD_HOME"
    "LANG=C.UTF-8"
    "npm_config_cache=$BUILD_HOME/npm"
    "NODE_OPTIONS=--max-old-space-size=$BUILD_HEAP_MB"
    "NEXT_TELEMETRY_DISABLED=1"
  )
  if ((with_env)); then
    vars+=("NODE_ENV=production")
    while IFS= read -r kv; do vars+=("$kv"); done < <(build_env_lines)
  fi
  (cd "$release" && runuser -u "$APP_USER" -- env -i "${vars[@]}" "$@")
}

health_check() {
  local waited=0
  while ((waited < HEALTH_TIMEOUT_SEC)); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$APP_DIR/.current.tmp"
  mv -Tf "$APP_DIR/.current.tmp" "$CURRENT_LINK"
}

# Copies changed systemd units from the root-owned checkout into
# /etc/systemd/system. The Cloudflare refresh timer is installed only while
# CLOUDFLARE_PROXY=1, and removed again when it is switched off.
install_units() {
  local src=$DEPLOY_SRC changed=0 proxy=0 unit
  local -a units=("${UNITS[@]}")
  if cloudflare_proxy; then
    proxy=1
    units+=("${CF_UNITS[@]}")
  fi
  for unit in "${units[@]}"; do
    if ! cmp -s "$src/$unit" "/etc/systemd/system/$unit"; then
      install -m 644 -o root -g root "$src/$unit" "/etc/systemd/system/$unit"
      info "Installed $unit"
      changed=1
    fi
  done
  if ((!proxy)); then
    for unit in "${CF_UNITS[@]}"; do
      if [[ -f /etc/systemd/system/$unit ]]; then
        systemctl disable --now --quiet "$unit" 2>/dev/null || true
        rm -f -- "/etc/systemd/system/$unit"
        info "Removed $unit (CLOUDFLARE_PROXY is off)"
        changed=1
      fi
    done
  fi
  if ((changed)); then systemctl daemon-reload; fi
  systemctl enable --quiet verdict.service
  systemctl enable --now --quiet verdict-backup.timer
  systemctl enable --now --quiet verdict-errors.timer
  systemctl enable --now --quiet verdict-watch.timer
  systemctl enable --now --quiet verdict-restore-drill.timer
  if ((proxy)); then systemctl enable --now --quiet verdict-cloudflare-ips.timer; fi
}

# Prints the Caddyfile for this site: the template with its #?proxy or
# #?direct lines picked, then a redirect block for each extra host name.
caddyfile_text() {
  local host proxy=0 aliases legacy name
  host=$(site_host)
  if cloudflare_proxy; then proxy=1; fi
  aliases=$(redirect_hosts SITE_ALIASES "$host" "")
  legacy=$(redirect_hosts LEGACY_HOSTS "$host" "$aliases")
  # Comment lines keep the placeholder name, so the header still explains it.
  if ((proxy)); then
    sed -e '/^#%/d' -e '/^#?direct/d' -e 's/^#?proxy \{0,1\}//' "$DEPLOY_SRC/Caddyfile"
  else
    sed -e '/^#%/d' -e '/^#?proxy/d' -e 's/^#?direct \{0,1\}//' "$DEPLOY_SRC/Caddyfile"
  fi | sed "/^[[:space:]]*#/!s/__SITE_ADDRESS__/$host/g"
  if [[ -n $aliases ]]; then
    printf '\n# Other names of this site (SITE_ALIASES in %s).\n' "$ENV_FILE"
    while IFS= read -r name; do redirect_block "$name" "$host"; done <<<"$aliases"
  fi
  if [[ -n $legacy ]]; then
    printf '\n# Old addresses of this site (LEGACY_HOSTS in %s). They only work\n' "$ENV_FILE"
    printf '# while visitors can reach this server directly, without Cloudflare.\n'
    while IFS= read -r name; do redirect_block "$name" "$host"; done <<<"$legacy"
  fi
}

# Renders the Caddyfile template for this site into $1 and validates it.
# Runs before the build, so a bad config stops the deploy before anything
# is installed.
render_caddyfile() {
  local out=$1
  # caddy validate runs as root and opens the access log; a file it created
  # would be root's, and Caddy itself could then not write to it.
  if [[ ! -e $ACCESS_LOG ]]; then
    install -d -m 755 -o caddy -g caddy "$(dirname "$ACCESS_LOG")"
    install -m 640 -o caddy -g caddy /dev/null "$ACCESS_LOG"
  fi
  caddyfile_text >"$out"
  if ! caddy validate --adapter caddyfile --config "$out" >/dev/null 2>&1; then
    caddy validate --adapter caddyfile --config "$out" || true
    die "The rendered Caddyfile is invalid (see above). Nothing was changed."
  fi
}

reload_caddy() {
  systemctl enable --quiet caddy
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy
  else
    systemctl start caddy
  fi
}

# Installs the rendered Caddyfile $1 if it differs, then reloads Caddy.
install_caddyfile() {
  local rendered=$1
  if ! cmp -s "$rendered" "$CADDYFILE"; then
    install -m 644 -o root -g root "$rendered" "$CADDYFILE"
    info "Caddy now serves https://$(site_host)"
  fi
  reload_caddy
}

# Copies the installed units and Caddyfile into directory $1, so a rollback
# can put them back. A file that does not exist yet is simply not saved.
save_config() {
  local dir=$1 unit
  for unit in "${UNITS[@]}" "${CF_UNITS[@]}"; do
    if [[ -f /etc/systemd/system/$unit ]]; then cp -p "/etc/systemd/system/$unit" "$dir/$unit"; fi
  done
  if [[ -f $CADDYFILE ]]; then cp -p "$CADDYFILE" "$dir/Caddyfile"; fi
}

# Puts back what save_config saved in $1.
restore_config() {
  local dir=$1 unit changed=0
  for unit in "${UNITS[@]}" "${CF_UNITS[@]}"; do
    if [[ -f $dir/$unit ]] && ! cmp -s "$dir/$unit" "/etc/systemd/system/$unit"; then
      install -m 644 -o root -g root "$dir/$unit" "/etc/systemd/system/$unit"
      info "Restored the previous $unit"
      changed=1
    fi
  done
  # Cloudflare units the failed deploy installed for the first time.
  for unit in "${CF_UNITS[@]}"; do
    if [[ ! -f $dir/$unit && -f /etc/systemd/system/$unit ]]; then
      systemctl disable --now --quiet "$unit" 2>/dev/null || true
      rm -f -- "/etc/systemd/system/$unit"
      info "Removed $unit (installed by the failed deploy)"
      changed=1
    fi
  done
  if ((changed)); then systemctl daemon-reload; fi
  if [[ -f $dir/verdict-cloudflare-ips.timer ]]; then
    systemctl enable --now --quiet verdict-cloudflare-ips.timer || true
  fi
  if [[ -f $dir/Caddyfile ]] && ! cmp -s "$dir/Caddyfile" "$CADDYFILE"; then
    install -m 644 -o root -g root "$dir/Caddyfile" "$CADDYFILE"
    info "Restored the previous Caddyfile"
    reload_caddy || true
  fi
}

prune_releases() {
  local active name
  local -a all
  active=$(readlink -f "$CURRENT_LINK" || true)
  mapfile -t all < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  local excess=$((${#all[@]} - KEEP_RELEASES)) i
  for ((i = 0; i < excess; i++)); do
    name=$RELEASES_DIR/${all[i]}
    [[ $name == "$active" ]] && continue
    rm -rf -- "$name"
    info "Removed old release ${all[i]}"
  done
}

main() {
  local force=0 branch=""
  while (($#)); do
    case $1 in
      --force) force=1 ;;
      --branch)
        [[ $# -ge 2 ]] || die "--branch needs a branch name."
        branch=$2
        shift
        ;;
      -h | --help)
        awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
        exit 0
        ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done

  [[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash $0"
  [[ -d $REPO_DIR/.git ]] || die "$REPO_DIR is missing. Run setup.sh first."
  [[ -f $ENV_FILE ]] || die "$ENV_FILE is missing. Run setup.sh first."
  local path
  for path in "$APP_DIR" "$REPO_DIR" "$REPO_DIR/.git"; do
    [[ $(stat -c %U "$path") == root ]] ||
      die "$path must be owned by root. Run setup.sh again: sudo bash $DEPLOY_SRC/setup.sh"
  done
  install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$BUILD_HOME"

  # One deploy at a time.
  exec 9>/run/lock/verdict-update.lock
  flock -n 9 || die "Another update is already running."
  install -d -m 700 "$ALERT_DIR"
  touch "$ALERT_DIR/deploy-at"

  local free_mb
  free_mb=$(df --output=avail -m "$APP_DIR" | tail -n 1 | tr -d ' ')
  ((free_mb >= MIN_FREE_DISK_MB)) ||
    die "Only ${free_mb} MB of disk left; a build needs about ${MIN_FREE_DISK_MB} MB."

  log "Fetching the latest code"
  if [[ -z $branch ]]; then
    branch=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)
  fi
  git -C "$REPO_DIR" fetch --prune origin "$branch"
  git -C "$REPO_DIR" checkout --quiet --force -B "$branch" FETCH_HEAD
  local commit short
  commit=$(git -C "$REPO_DIR" rev-parse HEAD)
  short=${commit:0:7}
  info "Branch $branch at $short: $(git -C "$REPO_DIR" log -1 --format=%s)"
  local file
  for file in app/api/health/route.ts lib/ratelimit.ts deploy/aws-lightsail/verdict.service; do
    git -C "$REPO_DIR" cat-file -e "$commit:$file" 2>/dev/null ||
      die "Branch $branch has no $file, so it is not the version this guide deploys. Merge the branch with the AWS Lightsail deploy files into $branch and push it (see the README), then run this again."
  done

  local running=""
  if [[ -f $CURRENT_LINK/.verdict-commit ]]; then
    running=$(<"$CURRENT_LINK/.verdict-commit")
  fi
  if [[ $running == "$commit" && $force -eq 0 ]] && systemctl is-active --quiet verdict; then
    log "Commit $short is already running. Nothing to do."
    info "To rebuild anyway (e.g. after editing the env file), add --force."
    exit 0
  fi

  log "Checking the web server config"
  if ! cloudflare_proxy && cloudflare_firewall_on; then
    die "CLOUDFLARE_PROXY is off in $ENV_FILE, but ufw is on and lets only Cloudflare reach ports 80 and 443, so without Cloudflare's proxy nobody could reach the site. Turn the firewall off first (sudo ufw disable, and set FIREWALL_CLOUDFLARE_ONLY= empty), or set CLOUDFLARE_PROXY=1 again. Nothing was changed."
  fi
  local workdir
  workdir=$(mktemp -d)
  # shellcheck disable=SC2064 # expand $workdir now
  trap "rm -rf -- '$workdir'" EXIT
  if cloudflare_proxy; then
    # The Caddyfile imports this list, so it must exist before validation.
    # A changed list is loaded into the running Caddy right away (if its
    # current Caddyfile imports it), so it is in use even if the build fails.
    if ! bash "$DEPLOY_SRC/cloudflare-ips.sh" --no-firewall; then
      [[ -f $CF_SNIPPET ]] || die "CLOUDFLARE_PROXY=1 needs Cloudflare's address list, and it could not be fetched (see above)."
      info "Using the previous Cloudflare address list."
    fi
  fi
  render_caddyfile "$workdir/Caddyfile.new"
  info "OK"

  local release
  release=$RELEASES_DIR/$(date -u +%Y%m%d-%H%M%S)-$short
  log "Building $short in $release"
  info "This takes several minutes on the smallest plan. The site stays up meanwhile."
  as_app mkdir -p "$release"
  # Remove a half-built release if anything below fails before the switch.
  # shellcheck disable=SC2064 # expand the paths now, not when the trap fires
  trap "rm -rf -- '$workdir' '$release'; echo 'The build failed. The running site was not changed.' >&2" EXIT
  # git runs as root on the root-owned checkout; only tar writes, as the app user.
  git -C "$REPO_DIR" archive --format=tar "$commit" | as_app tar -x -C "$release"
  printf '%s\n' "$commit" | as_app tee "$release/.verdict-commit" >/dev/null

  log "Installing dependencies (npm ci)"
  # No env file values here: package install scripts never see the settings.
  # --include=dev because the build needs the devDependencies.
  build_step "$release" npm ci --include=dev --no-audit --no-fund
  log "Building the app (npm run build)"
  build_step "$release" --with-build-env npm run build
  [[ -f $release/.next/BUILD_ID ]] || die "The build produced no .next/BUILD_ID."
  # From here on, an unexpected stop puts the saved units and Caddyfile back.
  # shellcheck disable=SC2064 # expand $workdir now; CONFIG_SAVED when it fires
  trap "if [[ \${CONFIG_SAVED-0} == 1 ]]; then restore_config '$workdir'; fi; rm -rf -- '$workdir'" EXIT

  # Only an earlier release counts; on the first deploy there is none.
  local previous=""
  if [[ -L $CURRENT_LINK ]]; then
    previous=$(readlink -f "$CURRENT_LINK" || true)
    [[ $previous == "$RELEASES_DIR"/* && -d $previous ]] || previous=""
  fi

  # Again: a slow build can use up most of the watcher's 30 minutes.
  touch "$ALERT_DIR/deploy-at"
  log "Installing service and web server config"
  save_config "$workdir"
  CONFIG_SAVED=1
  install_units
  install_caddyfile "$workdir/Caddyfile.new"

  log "Switching to the new release and restarting"
  switch_to "$release"
  # A failed start is caught by the health check below, which rolls back.
  systemctl restart verdict || info "The service did not start; see the log below."

  log "Checking that the site answers"
  if health_check; then
    CONFIG_SAVED=0
    prune_releases
    bash "$DEPLOY_SRC/watch.sh" --rebaseline >/dev/null || info "Could not update the watcher's baseline."
    log "Success: commit $short is live at $(env_value NEXT_PUBLIC_SITE_URL)"
    exit 0
  fi

  printf '\nERROR: the new release did not answer %s within %ss.\n' "$HEALTH_URL" "$HEALTH_TIMEOUT_SEC" >&2
  info "Recent log lines:"
  journalctl -u verdict -n 30 --no-pager || true
  if [[ -n $previous && $previous != "$release" ]]; then
    log "Rolling back to $(basename "$previous")"
    switch_to "$previous"
    restore_config "$workdir"
    CONFIG_SAVED=0
    systemctl restart verdict || true
    if health_check; then
      info "Rolled back. The site runs the previous release again."
    else
      info "The previous release does not answer either. Check: journalctl -u verdict -n 100"
    fi
    rm -rf -- "$release"
  else
    # Nothing older to run, so the new units and Caddyfile stay with it.
    CONFIG_SAVED=0
    info "There is no earlier release to go back to. The failed build is kept in"
    info "$release for debugging; fix the problem, push, and run sudo verdict-update."
  fi
  exit 1
}

main "$@"
