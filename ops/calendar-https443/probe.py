#!/usr/bin/env python3
"""Read-only acceptance probe using the original owner's REALITY credentials locally."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ROOT = Path('/opt/dayweave-ics443')


def owner_proxy():
    config = json.loads(Path('/etc/vps-vless-fallback/config.json').read_text())
    inbound = next(i for i in config['inbounds'] if i.get('tag') == 'vless-fallback-in')
    settings = inbound['streamSettings']['realitySettings']
    key = X25519PrivateKey.from_private_bytes(base64.urlsafe_b64decode(settings['privateKey'] + '==='))
    public = base64.urlsafe_b64encode(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode().rstrip('=')
    user = inbound['settings']['clients'][0]
    client = {
        'log': {'loglevel': 'none'},
        'inbounds': [{'listen': '127.0.0.1', 'port': 19443, 'protocol': 'socks', 'settings': {'auth': 'noauth', 'udp': False}}],
        'outbounds': [{'protocol': 'vless', 'settings': {'vnext': [{'address': '45.77.68.130', 'port': 443, 'users': [{'id': user['id'], 'encryption': 'none', 'flow': user.get('flow', '')}]}]},
            'streamSettings': {'network': 'tcp', 'security': 'reality', 'realitySettings': {
                'serverName': settings['serverNames'][0], 'fingerprint': 'chrome', 'publicKey': public,
                'shortId': settings['shortIds'][0]}}}],
    }
    with tempfile.TemporaryDirectory(prefix='owner-probe-', dir=ROOT) as directory:
        path = Path(directory) / 'client.json'
        path.write_text(json.dumps(client))
        os.chmod(path, 0o600)
        with subprocess.Popen(['/opt/vps-vless-fallback/xray', 'run', '-config', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                for attempt in range(5):
                    time.sleep(1)
                    result = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--max-time', '15', '--socks5-hostname', '127.0.0.1:19443', 'https://www.cloudflare.com/cdn-cgi/trace'], capture_output=True, text=True)
                    if result.returncode == 0 and 'ip=45.77.68.130' in result.stdout:
                        print('owner_proxy=PASS', flush=True)
                        return
                    if process.poll() is not None:
                        break
                raise RuntimeError('Original REALITY proxy end-to-end check failed')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    owner_proxy()
