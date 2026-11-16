#!/bin/bash
set -euo pipefail
root=/opt/dayweave-ics443
[ "${RENEWED_LINEAGE:-}" = "$root/acme/live/dayweave-ip" ] || exit 0
umask 077
cat "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" > "$root/tls/calendar.next.pem"
cp -a "$root/tls/calendar.pem" "$root/tls/calendar.previous.pem"
mv "$root/tls/calendar.next.pem" "$root/tls/calendar.pem"
if /usr/sbin/haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy.service; then
    rm "$root/tls/calendar.previous.pem"
else
    mv "$root/tls/calendar.previous.pem" "$root/tls/calendar.pem"
    exit 1
fi
