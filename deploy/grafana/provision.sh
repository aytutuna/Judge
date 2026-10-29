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
#   GRAFANA_PUSHOVER_USER   Pushover user key and application token: critical
#   GRAFANA_PUSHOVER_TOKEN  alerts go out at emergency priority
#   NTFY_TOPIC              optional: critical alerts to this ntfy topic too
#   NTFY_URL                ntfy server (default https://ntfy.sh)
#   GRAFANA_CLOUD_TOKEN     optional: an access policy token for this stack
#                           with the scopes stacks:read, metrics:write,
#                           logs:write and traces:write. It registers Synthetic
#                           Monitoring (POST /api/v1/register/install on the
#                           stack region's Synthetic Monitoring API), which
#                           keeps the token to publish the probes' results: give
#                           it no expiry and do not delete it. Without it the
#                           synthetic checks are skipped.
#
# Safe to run again: everything is created, or updated in place by its uid or
# name, so a run puts back what these files say. The rules, contact points and
# policy stay editable in the Grafana UI (X-Disable-Provenance).
#
# Needs curl and jq 1.6 or later.
set -euo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SITE=https://okjudge.com
CHECKS=("judge-site $SITE/" "judge-health $SITE/api/health")
# The site-down alert fires when both fail.
PROBES=(Frankfurt London)

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# call TOKEN CURL_ARGS...: a JSON request with "Authorization: Bearer TOKEN".
# The token goes in through a file descriptor, so it never shows in ps.
call() {
  local token=$1
  shift
  curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s\n' "$token") \
    -H 'Content-Type: application/json' "$@"
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
  existing=$(grafana "$GRAFANA_URL/api/v1/provisioning/contact-points" | jq -r '.[].uid')
  points=$(fill "$HERE/contact-points.json" | jq -c '.[]')
  while IFS= read -r point; do
    uid=$(jq -r .uid <<<"$point")
    name=$(jq -r .name <<<"$point")
    if [[ $name == ntfy && -z ${NTFY_TOPIC-} ]]; then continue; fi
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
  grafana -X PUT --data-binary @- "$GRAFANA_URL/api/v1/provisioning/policies" <<<"$policy" >/dev/null
  info "Critical alerts: $(jq -r '[.routes[].receiver] | join(", ")' <<<"$policy"); the rest: email."
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
  local slug stack region sm token probes name id ids="" existing entry job target check old
  log "Synthetic checks"
  slug=${GRAFANA_URL#https://}
  slug=${slug%%.*}
  stack=$(call "$GRAFANA_CLOUD_TOKEN" "https://grafana.com/api/instances/$slug")
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
  # Sets up Synthetic Monitoring for the stack, or finds the existing setup,
  # and returns a token for its API.
  token=$(jq '{stackId: .id, metricsInstanceId: .hmInstancePromId, logsInstanceId: .hlInstanceId}' <<<"$stack" |
    call "$GRAFANA_CLOUD_TOKEN" -X POST --data-binary @- "$sm/api/v1/register/install" | jq -r '.accessToken // empty')
  [[ -n $token ]] || die "Synthetic Monitoring at $sm returned no access token."
  info "Registered with $sm"

  probes=$(call "$token" "$sm/api/v1/probe/list")
  for name in "${PROBES[@]}"; do
    id=$(jq -r --arg n "$name" 'first(.[] | select(.name == $n and .public)) | .id' <<<"$probes")
    [[ -n $id ]] || die "There is no public probe named $name. Pick others in PROBES: $(jq -r '[.[] | select(.public) | .name] | join(", ")' <<<"$probes")"
    ids+=${ids:+,}$id
  done

  existing=$(call "$token" "$sm/api/v1/check/list")
  for entry in "${CHECKS[@]}"; do
    read -r job target <<<"$entry"
    check=$(jq -n --arg job "$job" --arg target "$target" --argjson probes "[$ids]" '{
      job: $job, target: $target, enabled: true, frequency: 60000, timeout: 10000,
      probes: $probes, labels: [], basicMetricsOnly: false, alertSensitivity: "none",
      settings: {http: {method: "GET", ipVersion: "V4", failIfNotSSL: true, noFollowRedirects: false}}
    }')
    old=$(jq -c --arg job "$job" 'first(.[] | select(.job == $job))' <<<"$existing")
    if [[ -n $old ]]; then
      jq --argjson old "$old" '. + {id: $old.id, tenantId: $old.tenantId}' <<<"$check" |
        call "$token" -X POST --data-binary @- "$sm/api/v1/check/update" >/dev/null
      info "Updated $job: $target from ${PROBES[*]}"
    else
      call "$token" -X POST --data-binary @- "$sm/api/v1/check/add" <<<"$check" >/dev/null
      info "Added $job: $target from ${PROBES[*]}"
    fi
  done
}

main() {
  local var
  for var in GRAFANA_URL GRAFANA_SA_TOKEN ALERT_EMAIL GRAFANA_PUSHOVER_USER GRAFANA_PUSHOVER_TOKEN; do
    [[ -n ${!var-} ]] || die "$var is not set (see the top of $0)."
  done
  command -v jq >/dev/null || die "This needs jq."
  GRAFANA_URL=${GRAFANA_URL%/}
  NTFY_URL=${NTFY_URL:-https://ntfy.sh}
  export NTFY_URL=${NTFY_URL%/}

  find_datasources
  make_folder
  contact_points
  notification_policy
  alert_rules
  if [[ -n ${GRAFANA_CLOUD_TOKEN-} ]]; then
    synthetic_checks
  else
    log "Synthetic checks"
    info "Skipped: GRAFANA_CLOUD_TOKEN is not set."
  fi
  log "Done. See them under Alerting > Alert rules in $GRAFANA_URL"
}

main "$@"
