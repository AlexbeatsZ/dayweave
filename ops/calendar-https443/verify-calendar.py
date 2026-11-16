#!/usr/bin/env python3
"""Verify the IP TLS endpoint and original ICS without exposing the secret URL."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

root = Path('/opt/dayweave-ics443')
path = (root / 'feed-path').read_text().strip()
base = sys.argv[1] if len(sys.argv) > 1 else 'https://45.77.68.130'
original = 'https://cdn.u3146344.nyat.app:63573'


def get(url, method='GET'):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=20) as response:
            return response.status, response.headers.get('Content-Type', ''), response.read()
    except urllib.error.HTTPError as error:
        return error.code, '', b''


try:
    status, kind, body = get(base + path)
    assert status == 200 and kind.startswith('text/calendar') and b'BEGIN:VCALENDAR' in body
    upstream_status, _, upstream_body = get(original + path)
    assert upstream_status == 200 and body == upstream_body, 'ICS differs from original upstream'
    assert get(base + path, 'HEAD')[0] == 200
    for suffix in ['/', '/dayweave/sync', path + '?query=1']:
        assert get(base + suffix)[0] == 404
    assert get(base + path, 'POST')[0] == 404
    print(json.dumps({'calendar': 'PASS', 'tls': 'verified', 'sameBytes': True, 'events': body.count(b'BEGIN:VEVENT'), 'head': 200, 'unrelatedRoutes': 404}), flush=True)
except Exception as error:
    # urllib exceptions can embed the complete capability URL; never print their text.
    print('calendar=FAIL type=' + type(error).__name__, flush=True)
    raise SystemExit(1)
