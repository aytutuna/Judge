#!/usr/bin/env bash
# Sets up Grafana Cloud alerting for Judge: the folder, contact points,
# notification policy and alert rules in this directory, and the synthetic
# checks on the site. Run it on your own machine (Linux, macOS or WSL), not on
# the server:
#
#   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_SA_TOKEN=glsa_... \
#   ALERT_EMAIL=you@example.org GRAFANA_PUSHOVER_USER=... GRAFANA_PUSHOVER_TOKEN=... \
#     bash deploy/grafana/provision.sh
#
#   GRAFANA_URL             the stack's address
#   GRAFANA_SA_TOKEN        token of a service account with the Admin role
#                           (Administration > Users and access > Service accounts)
#   ALERT_EMAIL             where every alert is emailed
#   GRAFANA_PUSHOVER_USER   optional: Pushover user key and application token;
#   GRAFANA_PUSHOVER_TOKEN  critical alerts then also go out at emergency priority
#   NTFY_TOPIC              optional: critical alerts to this ntfy topic too
#   NTFY_URL                ntfy server (default https://ntfy.sh)
#   GRAFANA_CLOUD_TOKEN     optional: an access policy token for this stack
#                           with the scopes stacks:read, metrics:write,
#                           logs:write and traces:write. It registers Synthetic
#                           Monitoring (POST /api/v1/register/install), which
#                           keeps the token to publish the probes' results: give
#                           it no expiry and do not delete it.
#   SM_TOKEN                optional: a Synthetic Monitoring access token
#                           (Testing & synthetics > Synthetics > Config >
#                           Access tokens) instead of registering again.
#
# Without GRAFANA_CLOUD_TOKEN or SM_TOKEN the synthetic checks are skipped. The
# Synthetic Monitoring API's address comes from the stack's plugin settings,
# or from its region while Synthetic Monitoring was never opened there.
#
# Safe to run again: everything is created, or updated in place by its uid or
# name, so a run puts back what these files say. The rules, contact points and
# policy stay editable in the Grafana UI (X-Disable-Provenance).
#
# Needs curl and jq 1.6 or later.
set -euo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SITE=https://okjudge.com
# Job, target and how often in ms. Every 15 minutes for the home page keeps
# both checks from two probes under the free tier's 100k runs a month.
CHECKS=("judge-site $SITE/ 900000" "judge-health $SITE/api/health 60000")
# The site-down alert fires when both fail.
PROBES=(Frankfurt London)

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# call TOKEN CURL_ARGS...: a JSON request with "Authorization: Bearer TOKEN".
# The token goes in through a file descriptor, so it never shows in ps. On an
# error status the response (Grafana's reason) goes to stderr.
call() {
  local token=$1 out
  shift
  if ! out=$(curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s\n' "$token") \
    -H 'Content-Type: application/json' "$@"); then
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

grafana() { call "$GRAFANA_SA_TOKEN" -H 'X-Disable-Provenance: true' "$@"; }

# Prints JSON file $1 with each ${NAME} in its strings replaced by the
# environment variable NAME.
fill() {
  jq 'walk(if type == "string" then gsub("\\$\\{(?<name>[A-Z_]+)\\}"; $ENV[.name] // "") else . end)' "$1"
}

find_datasources() {
  local list
  log "Data sources"
  list=$(grafana "$GRAFANA_URL/api/datasources")
  PROM_UID=$(jq -r 'first(.[] | select(.type == "prometheus" and (.name | endswith("-prom")))) | .uid' <<<"$list")
  LOKI_UID=$(jq -r 'first(.[] | select(.type == "loki" and (.name | endswith("-logs")))) | .uid' <<<"$list")
  [[ -n $PROM_UID && -n $LOKI_UID ]] ||
    die "Could not find the stack's grafanacloud-...-prom and -logs data sources."
  export PROM_UID LOKI_UID
  info "Prometheus $PROM_UID, Loki $LOKI_UID"
}

make_folder() {
  local uid
  uid=$(jq -r .folder.uid "$HERE/alerts.json")
  log "Folder $uid"
  if grafana "$GRAFANA_URL/api/folders/$uid" >/dev/null 2>&1; then
    info "Already there."
    return
  fi
  jq .folder "$HERE/alerts.json" | grafana -X POST --data-binary @- "$GRAFANA_URL/api/folders" >/dev/null
  info "Created."
}

contact_points() {
  local existing points point uid name
  log "Contact points"
  existing=$(grafana "$GRAFANA_URL/api/v1/provisioning/contact-points")
  existing=$(jq -r '.[].uid' <<<"$existing")
  points=$(fill "$HERE/contact-points.json" | jq -c '.[]')
  while IFS= read -r point; do
    uid=$(jq -r .uid <<<"$point")
    name=$(jq -r .name <<<"$point")
    if [[ $name == ntfy && -z ${NTFY_TOPIC-} ]]; then continue; fi
    if [[ $name == pushover-critical && -z ${GRAFANA_PUSHOVER_USER-} ]]; then continue; fi
    if grep -qxF -- "$uid" <<<"$existing"; then
      grafana -X PUT --data-binary @- "$GRAFANA_URL/api/v1/provisioning/contact-points/$uid" <<<"$point" >/dev/null
      info "Updated $name"
    else
      grafana -X POST --data-binary @- "$GRAFANA_URL/api/v1/provisioning/contact-points" <<<"$point" >/dev/null
      info "Created $name"
    fi
  done <<<"$points"
}

notification_policy() {
  local policy
  log "Notification policy"
  policy=$(jq . "$HERE/policy.json")
  if [[ -z ${NTFY_TOPIC-} ]]; then
    policy=$(jq 'del(.routes[] | select(.receiver == "ntfy"))' <<<"$policy")
  fi
  if [[ -z ${GRAFANA_PUSHOVER_USER-} ]]; then
    policy=$(jq 'del(.routes[] | select(.receiver == "pushover-critical"))' <<<"$policy")
  fi
  grafana -X PUT --data-binary @- "$GRAFANA_URL/api/v1/provisioning/policies" <<<"$policy" >/dev/null
  info "Critical alerts: $(jq -r '[.routes[] | select(.object_matchers[0][0] == "severity") | .receiver] | join(", ")' <<<"$policy"); the rest: email."
}

# A rule group's PUT creates, updates and removes its rules to match the body.
alert_rules() {
  local rules folder group
  log "Alert rules"
  rules=$(fill "$HERE/alerts.json")
  folder=$(jq -r .folder.uid <<<"$rules")
  for group in $(jq -r '.groups[].title' <<<"$rules"); do
    jq --arg g "$group" '.groups[] | select(.title == $g)' <<<"$rules" |
      grafana -X PUT --data-binary @- "$GRAFANA_URL/api/v1/provisioning/folder/$folder/rule-groups/$group" >/dev/null
    info "$group: $(jq --arg g "$group" '.groups[] | select(.title == $g) | .rules | length' <<<"$rules") rules"
  done
}

synthetic_checks() {
  local settings sm slug stack region resp token probes name id ids="" existing entry job target freq check old
  log "Synthetic checks"
  # Set once Synthetic Monitoring has been opened in the stack.
  settings=$(grafana "$GRAFANA_URL/api/plugins/grafana-synthetic-monitoring-app/settings") || settings={}
  sm=$(jq -r '.jsonData.apiHost // empty' <<<"$settings")
  if [[ -n $sm && $sm != *://* ]]; then sm=https://$sm; fi
  sm=${sm%/}

  if [[ -n ${SM_TOKEN-} ]]; then
    [[ -n $sm ]] || die "SM_TOKEN is set, but the stack does not name its Synthetic Monitoring API yet. Open Testing & synthetics > Synthetics once, or use GRAFANA_CLOUD_TOKEN."
    token=$SM_TOKEN
  else
    slug=${GRAFANA_URL#https://}
    slug=${slug%%.*}
    stack=$(call "$GRAFANA_CLOUD_TOKEN" "https://grafana.com/api/instances/$slug")
    if [[ -z $sm ]]; then
      region=$(jq -r .regionSlug <<<"$stack")
      # The same mapping as Grafana's Terraform provider.
      case $region in
        us) sm=https://synthetic-monitoring-api.grafana.net ;;
        eu) sm=https://synthetic-monitoring-api-eu-west.grafana.net ;;
        au) sm=https://synthetic-monitoring-api-au-southeast.grafana.net ;;
        prod-gb-south-0) sm=https://synthetic-monitoring-api-gb-south.grafana.net ;;
        us-azure) sm=https://synthetic-monitoring-api-us-central-7.grafana.net ;;
        *) sm=https://synthetic-monitoring-api-${region#prod-}.grafana.net ;;
      esac
    fi
    # Sets up Synthetic Monitoring for the stack, or finds the existing setup,
    # and returns a token for its API.
    resp=$(jq '{stackId: .id, metricsInstanceId: .hmInstancePromId, logsInstanceId: .hlInstanceId}' <<<"$stack" |
      call "$GRAFANA_CLOUD_TOKEN" -X POST --data-binary @- "$sm/api/v1/register/install")
    token=$(jq -r '.accessToken // empty' <<<"$resp")
    [[ -n $token ]] || die "Synthetic Monitoring at $sm returned no access token: $resp"
    info "Registered with $sm"
  fi

  probes=$(call "$token" "$sm/api/v1/probe/list")
  for name in "${PROBES[@]}"; do
    id=$(jq -r --arg n "$name" 'first(.[] | select(.name == $n and .public)) | .id' <<<"$probes")
    [[ -n $id ]] || die "There is no public probe named $name. Pick others in PROBES: $(jq -r '[.[] | select(.public) | .name] | join(", ")' <<<"$probes")"
    ids+=${ids:+,}$id
  done

  existing=$(call "$token" "$sm/api/v1/check/list")
  for entry in "${CHECKS[@]}"; do
    read -r job target freq <<<"$entry"
    check=$(jq -n --arg job "$job" --arg target "$target" --argjson freq "$freq" --argjson probes "[$ids]" '{
      job: $job, target: $target, enabled: true, frequency: $freq, timeout: 10000,
      probes: $probes, labels: [], basicMetricsOnly: false, alertSensitivity: "none",
      settings: {http: {method: "GET", ipVersion: "V4", failIfNotSSL: true, noFollowRedirects: false}}
    }')
    old=$(jq -c --arg job "$job" 'first(.[] | select(.job == $job))' <<<"$existing")
    if [[ -n $old ]]; then
      jq --argjson old "$old" '. + {id: $old.id, tenantId: $old.tenantId}' <<<"$check" |
        call "$token" -X POST --data-binary @- "$sm/api/v1/check/update" >/dev/null
      info "Updated $job: $target every $((freq / 1000))s from ${PROBES[*]}"
    else
      call "$token" -X POST --data-binary @- "$sm/api/v1/check/add" <<<"$check" >/dev/null
      info "Added $job: $target every $((freq / 1000))s from ${PROBES[*]}"
    fi
  done
}

main() {
  local var
  for var in GRAFANA_URL GRAFANA_SA_TOKEN ALERT_EMAIL; do
    [[ -n ${!var-} ]] || die "$var is not set (see the top of $0)."
  done
  if [[ -n ${GRAFANA_PUSHOVER_USER-}${GRAFANA_PUSHOVER_TOKEN-} && ( -z ${GRAFANA_PUSHOVER_USER-} || -z ${GRAFANA_PUSHOVER_TOKEN-} ) ]]; then
    die "Set both GRAFANA_PUSHOVER_USER and GRAFANA_PUSHOVER_TOKEN, or neither."
  fi
  command -v jq >/dev/null || die "This needs jq."
  GRAFANA_URL=${GRAFANA_URL%/}
  NTFY_URL=${NTFY_URL:-https://ntfy.sh}
  export NTFY_URL=${NTFY_URL%/}

  find_datasources
  make_folder
  contact_points
  notification_policy
  alert_rules
  if [[ -n ${GRAFANA_CLOUD_TOKEN-}${SM_TOKEN-} ]]; then
    synthetic_checks
  else
    log "Synthetic checks"
    info "Skipped: neither GRAFANA_CLOUD_TOKEN nor SM_TOKEN is set."
  fi
  log "Done. See them under Alerting > Alert rules in $GRAFANA_URL"
}

main "$@"
