#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
systemctl mask haproxy.service
apt-get install -y --no-install-recommends haproxy python3-venv
python3 -m venv /opt/dayweave-ics443/.venv
/opt/dayweave-ics443/.venv/bin/pip install 'certbot==5.10.0'
touch /opt/dayweave-ics443/install.complete
