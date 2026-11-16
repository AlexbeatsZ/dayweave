#!/bin/bash
set -euo pipefail
root=/opt/dayweave-ics443
# Disarm marker is written only after all cutover checks pass.
[ -e "$root/cutover.complete" ] && exit 0
systemctl stop haproxy.service || true
systemctl disable haproxy.service || true
cp -a "$root/recovery/xray-config.json" /etc/vps-vless-fallback/config.json
systemctl restart vps-vless-fallback.service
printf '%s\n' 'ROLLED_BACK' > "$root/cutover.result"
