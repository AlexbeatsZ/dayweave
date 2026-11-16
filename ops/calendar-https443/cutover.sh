#!/bin/bash
set -euo pipefail
root=/opt/dayweave-ics443
rollback() { trap - ERR TERM INT; "$root/rollback.sh"; exit 1; }
trap rollback ERR TERM INT
# Refuse to run without both preflight proofs; no public port is touched before here.
test -f "$root/certificate.complete"
test -f "$root/preflight.complete"
/usr/sbin/haproxy -c -f "$root/haproxy.cfg"
/opt/vps-vless-fallback/xray run -test -config "$root/xray-candidate.json"
# A separate systemd timer restores the original proxy even if this script is killed.
systemd-run --unit=dayweave-ics443-rollback --on-active=120s "$root/rollback.sh"
cp -a "$root/xray-candidate.json" /etc/vps-vless-fallback/config.json
systemctl restart vps-vless-fallback.service
systemctl unmask haproxy.service
cp "$root/haproxy.cfg" /etc/haproxy/haproxy.cfg
systemctl enable --now haproxy.service
"$root/.venv/bin/python" "$root/probe.py"
"$root/.venv/bin/python" "$root/verify-calendar.py"
printf '%s\n' 'PASSED' > "$root/cutover.result"
touch "$root/cutover.complete"
systemctl stop dayweave-ics443-rollback.timer || true
trap - ERR TERM INT
