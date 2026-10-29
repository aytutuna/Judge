#!/usr/bin/env bash
# Sends an alert by email to ALERT_EMAIL through Resend, with the app's own
# RESEND_API_KEY and EMAIL_FROM, and as a phone push to the ntfy topic
# NTFY_TOPIC (all from /etc/verdict/verdict.env, loaded by systemd):
#
#   bash alert.sh [--critical] "<subject>" "<text>"
#
#   NTFY_TOPIC   ntfy topic to publish to (no push while empty); anyone who
#                knows the name can read it, so make it long and random
#   NTFY_URL     ntfy server (default https://ntfy.sh)
#   NTFY_TOKEN   access token, for a server or topic that needs one
#
# --critical sends the push at the highest priority, which rings through
# do-not-disturb on most phones. Exits non-zero only if neither the email nor
# the push went out.
set -euo pipefail

json_string() {
  local s
  s=$(printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037')
  s=${s//\/\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\t}
  s=${s//$'\r'/}
  s=${s//$'\n'/\n}
  printf '"%s"' "$s"
}

send_email() {
  local subject=$1 text=$2 body
  [[ -n ${ALERT_EMAIL-} ]] || return 1
  if [[ -z ${RESEND_API_KEY-} || -z ${EMAIL_FROM-} ]]; then
    echo "Email not sent (RESEND_API_KEY or EMAIL_FROM is not set): $subject" >&2
    return 1
  fi
  body=$(printf '{"from":%s,"to":[%s],"subject":%s,"text":%s}' \
    "$(json_string "$EMAIL_FROM")" "$(json_string "$ALERT_EMAIL")" \
    "$(json_string "$subject")" "$(json_string "$text")")
  # The key goes in through a file descriptor, so it never shows in ps.
  if ! curl -fsS --max-time 20 --retry 2 -o /dev/null \
    -H @<(printf 'Authorization: Bearer %s\n' "$RESEND_API_KEY") \
    -H 'Content-Type: application/json' \
    --data-binary @- https://api.resend.com/emails <<<"$body"; then
    echo "Email not sent (Resend did not accept it): $subject" >&2
    return 1
  fi
}

send_push() {
  local subject=$1 text=$2 priority=$3 tags=$4 base=${NTFY_URL:-https://ntfy.sh}
  [[ -n ${NTFY_TOPIC-} ]] || return 1
  # The topic works like a password, so the URL goes in through a config
  # file descriptor too.
  if ! curl -fsS --max-time 20 --retry 2 -o /dev/null \
    -K <(
      printf 'url = "%s/%s"\n' "${base%/}" "$NTFY_TOPIC"
      if [[ -n ${NTFY_TOKEN-} ]]; then printf 'header = "Authorization: Bearer %s"\n' "$NTFY_TOKEN"; fi
    ) \
    -H "Title: ${subject//[$'\r\n']/ }" -H "Priority: $priority" -H "Tags: $tags" \
    --data-binary @- <<<"$text"; then
    echo "Push not sent (ntfy did not accept it): $subject" >&2
    return 1
  fi
}

main() {
  local priority=3 tags=bell
  if [[ ${1-} == --critical ]]; then
    priority=5
    tags=rotating_light
    shift
  fi
  local subject=$1 text=$2 sent=0
  if send_email "$subject" "$text"; then sent=1; fi
  if send_push "$subject" "$text" "$priority" "$tags"; then sent=1; fi
  if ((!sent)); then
    if [[ -z ${ALERT_EMAIL-}${NTFY_TOPIC-} ]]; then
      echo "Alert not sent (neither ALERT_EMAIL nor NTFY_TOPIC is set): $subject" >&2
    else
      echo "Alert not sent: $subject" >&2
    fi
    exit 1
  fi
  echo "Alert sent: $subject"
}

main "$@"
