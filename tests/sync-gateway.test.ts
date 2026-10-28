import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway } from '../scripts/sync-gateway.mjs';

test('HTTPS gateway preserves subscription responses and limits encrypted sync to exact routes', async () => {
  const received: string[] = [];
  const upstream = http.createServer((request, response) => {
    received.push(request.url ?? '');
    response.writeHead(200, {
      'Subscription-Userinfo': 'total=100',
      'Content-Type': 'application/json',
    });
    request.pipe(response);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const gateway = createGateway({
    port: 0,
    subscriptionPort: upstreamPort,
    syncPort: upstreamPort,
  });
  const address = await gateway.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const subscription = await fetch(base + '/s/existing/file.yaml');
    assert.equal(subscription.status, 200);
    assert.equal(subscription.headers.get('subscription-userinfo'), 'total=100');
    for (const route of ['pair', 'sync', 'usage']) {
      const reply = await fetch(base + '/dayweave/' + route, {
        method: 'POST',
        body: '{"encrypted":true}',
      });
      assert.equal(await reply.text(), '{"encrypted":true}');
      assert.equal(received.at(-1), '/' + route);
    }
    for (const route of [
      '/dayweave/api/v1/tasks',
      '/dayweave/sync?target=other',
      '/dayweave/%73ync',
    ]) {
      assert.equal((await fetch(base + route, { method: 'POST' })).status, 404);
    }
    assert.equal((await fetch(base + '/dayweave/sync')).status, 403);
    assert.equal(
      (
        await fetch(base + '/dayweave/sync', {
          method: 'POST',
          headers: { origin: 'https://other.example' },
        })
      ).status,
      403,
    );
    assert.deepEqual(received, ['/s/existing/file.yaml', '/pair', '/sync', '/usage']);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    assert.equal((await fetch(base + '/dayweave/sync', { method: 'POST' })).status, 502);
  } finally {
    gateway.server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.server.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});
