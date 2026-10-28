import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const routes = new Set(['/dayweave/pair', '/dayweave/sync', '/dayweave/usage']);
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function headersFor(headers) {
  const blocked = new Set([
    ...hopHeaders,
    ...String(headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())),
  );
}

export function createGateway({ port = 18781, subscriptionPort = 18782, syncPort = 49732 } = {}) {
  for (const value of [port, subscriptionPort, syncPort])
    if (!Number.isInteger(value) || value < 0 || value > 65535)
      throw new Error('Invalid loopback port');
  const server = http.createServer((request, response) => {
    const automatic = request.url?.startsWith('/dayweave');
    const reject = (status) => {
      request.resume();
      response.writeHead(status, { 'Cache-Control': 'no-store', Connection: 'close' }).end();
    };
    if (automatic && !routes.has(request.url)) return reject(404);
    if (automatic && (request.method !== 'POST' || request.headers.origin)) return reject(403);
    const limit = automatic ? 70 * 1024 * 1024 : 2 * 1024 * 1024;
    if (Number(request.headers['content-length'] ?? 0) > limit) return reject(413);
    const headers = automatic
      ? { 'Content-Type': 'application/json' }
      : headersFor(request.headers);
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: automatic ? syncPort : subscriptionPort,
        path: automatic ? request.url.slice('/dayweave'.length) : request.url,
        method: request.method,
        headers: { ...headers, host: `127.0.0.1:${automatic ? syncPort : subscriptionPort}` },
        timeout: 90_000,
      },
      (reply) => {
        response.writeHead(reply.statusCode ?? 502, headersFor(reply.headers));
        reply.on('error', () => response.destroy());
        reply.pipe(response);
      },
    );
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        upstream.destroy();
        if (!response.headersSent) reject(413);
        else response.destroy();
      }
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'Cache-Control': 'no-store' }).end();
      else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.requestTimeout = 100_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 2_000;
  server.maxHeadersCount = 40;
  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address()));
      }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = createGateway();
  await gateway.listen();
  console.log('Dayweave HTTPS gateway ready on loopback:18781');
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      gateway.server.close(() => process.exit(0));
      gateway.server.closeAllConnections();
    });
}
