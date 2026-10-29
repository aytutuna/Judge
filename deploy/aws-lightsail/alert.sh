#!/usr/bin/env bash
# Emails an alert to ALERT_EMAIL through Resend, with the app's own
# RESEND_API_KEY and EMAIL_FROM (from /etc/verdict/verdict.env, loaded by
# systemd). Used by errors.sh and backup-upload.sh:
#
#   bash alert.sh "<subject>" "<text>"
#
# Exits non-zero if the email was not sent.
set -euo pipefail

json_string() {
  local s
  s=$(printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037')
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/}
  s=${s//$'\n'/\\n}
  printf '"%s"' "$s"
}

main() {
  local subject=$1 text=$2
  if [[ -z ${ALERT_EMAIL-} || -z ${RESEND_API_KEY-} || -z ${EMAIL_FROM-} ]]; then
    echo "Alert not sent (ALERT_EMAIL, RESEND_API_KEY or EMAIL_FROM is not set): $subject" >&2
    exit 1
  fi
  local body
  body=$(printf '{"from":%s,"to":[%s],"subject":%s,"text":%s}' \
    "$(json_string "$EMAIL_FROM")" "$(json_string "$ALERT_EMAIL")" \
    "$(json_string "$subject")" "$(json_string "$text")")
  # The key goes in through a file descriptor, so it never shows in ps.
  if ! curl -fsS --max-time 20 --retry 2 -o /dev/null \
    -H @<(printf 'Authorization: Bearer %s\n' "$RESEND_API_KEY") \
    -H 'Content-Type: application/json' \
    --data-binary @- https://api.resend.com/emails <<<"$body"; then
    echo "Alert not sent (Resend did not accept it): $subject" >&2
    exit 1
  fi
  echo "Alert sent: $subject"
}

main "$@"
