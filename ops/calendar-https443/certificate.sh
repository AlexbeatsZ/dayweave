#!/bin/bash
set -euo pipefail
root=/opt/dayweave-ics443
certbot="$root/.venv/bin/certbot"
args=(certonly --standalone --preferred-profile shortlived --ip-address 45.77.68.130 --cert-name dayweave-ip --agree-tos --register-unsafely-without-email --non-interactive --config-dir "$root/acme" --work-dir "$root/acme-work" --logs-dir "$root/acme-logs")
"$certbot" "${args[@]}" --dry-run
"$certbot" "${args[@]}"
cat "$root/acme/live/dayweave-ip/fullchain.pem" "$root/acme/live/dayweave-ip/privkey.pem" > "$root/tls/calendar.pem"
chmod 600 "$root/tls/calendar.pem"
touch "$root/certificate.complete"
