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

test('HTTPS gateway routes native MCP and OAuth without exposing the controller API', async () => {
  const received: Array<{ url?: string; auth?: string }> = [];
  const upstream = http.createServer((request, response) => {
    received.push({ url: request.url, auth: request.headers.authorization });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    request.pipe(response);
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = (upstream.address() as { port: number }).port;
  const gateway = createGateway({ port: 0, mcpPort: port, subscriptionPort: port });
  const address = await gateway.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const reply = await fetch(base + '/ai-decision/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer mcp-token' },
      body: '{"jsonrpc":"2.0"}',
    });
    assert.equal(await reply.text(), '{"jsonrpc":"2.0"}');
    assert.deepEqual(received.at(-1), { url: '/mcp', auth: 'Bearer mcp-token' });
    for (const [external, internal] of [
      ['/ai-decision/authorize?state=opaque', '/authorize?state=opaque'],
      ['/ai-decision/consent?request_id=opaque', '/consent?request_id=opaque'],
      ['/ai-decision/token', '/token'],
      ['/ai-decision/register', '/register'],
      ['/ai-decision/revoke', '/revoke'],
      [
        '/ai-decision/.well-known/oauth-authorization-server',
        '/.well-known/oauth-authorization-server',
      ],
      [
        '/.well-known/oauth-authorization-server/ai-decision',
        '/.well-known/oauth-authorization-server',
      ],
      [
        '/.well-known/oauth-protected-resource/ai-decision/mcp',
        '/.well-known/oauth-protected-resource/ai-decision/mcp',
      ],
    ]) {
      assert.equal((await fetch(base + external)).status, 200);
      assert.equal(received.at(-1)?.url, internal);
    }
    const count = received.length;
    for (const path of [
      '/ai-decision/v1/bridge/tools/commit_decision',
      '/ai-decision/health',
      '/ai-decision/%6dcp',
      '/ai-decision/mcp/other',
    ]) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    assert.equal(received.length, count);
    assert.equal((await fetch(base + '/s/original.yaml')).status, 200);
    assert.equal(received.at(-1)?.url, '/s/original.yaml');
  } finally {
    gateway.server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.server.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});

test('HTTPS gateway forwards only exact read-only Event calendar capabilities', async () => {
  const received: string[] = [];
  const upstream = http.createServer((request, response) => {
    received.push(request.url ?? '');
    response
      .writeHead(200, { 'Content-Type': 'text/calendar' })
      .end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createGateway({
    port: 0,
    syncPort: (upstream.address() as { port: number }).port,
  });
  const address = await gateway.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const route = `/dayweave/calendar/${'a'.repeat(64)}.ics`;
  try {
    assert.equal((await fetch(base + route)).status, 200);
    assert.equal(received[0], `/calendar/${'a'.repeat(64)}.ics`);
    assert.equal((await fetch(base + route, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(base + route, { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + route + '?other=1')).status, 404);
    assert.equal((await fetch(base + '/dayweave/calendar/short.ics')).status, 404);
    assert.equal(received.length, 2);
  } finally {
    gateway.server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => gateway.server.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});
