const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const b64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
export const unb64 = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
export const randomKey = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export interface Envelope {
  clientId: string;
  iv: string;
  data: string;
}
const aad = (path: string, id: string) => encoder.encode(`dayweave:1:${path}:${id}`);
export async function seal(
  value: unknown,
  key: string,
  path: string,
  clientId: string,
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = await crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt']);
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(path, clientId) },
    secret,
    encoder.encode(JSON.stringify(value)),
  );
  return { clientId, iv: b64(iv), data: b64(new Uint8Array(result)) };
}
export async function openEnvelope<T>(value: Envelope, key: string, path: string): Promise<T> {
  if (
    !value ||
    typeof value.clientId !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.data !== 'string' ||
    unb64(value.iv).length !== 12
  )
    throw new Error('同步消息格式无效');
  const secret = await crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['decrypt']);
  const result = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(value.iv), additionalData: aad(path, value.clientId) },
    secret,
    unb64(value.data),
  );
  return JSON.parse(decoder.decode(result)) as T;
}
export async function hashText(value: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export function localEndpoint(input: string): string {
  const url = new URL(input);
  const host = url.hostname;
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(host)
  )
    throw new Error('请输入局域网 IP 地址，例如 http://192.168.31.32:49732');
  const n = host.split('.').map(Number);
  if (
    n.some((x) => x > 255) ||
    !(
      n[0] === 10 ||
      n[0] === 127 ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      (n[0] === 169 && n[1] === 254)
    )
  )
    throw new Error('同步地址须为局域网或 Tailscale 地址');
  if (!['', '/'].includes(url.pathname)) throw new Error('同步地址不应包含路径');
  return url.origin;
}
export function syncEndpoint(input: string): string {
  const url = new URL(input);
  if (url.protocol === 'http:') return localEndpoint(input);
  if (!/^https:\/\/[A-Za-z0-9.:\[\]-]+(?:\/[A-Za-z0-9_-]+)*\/?$/i.test(input))
    throw new Error('同步 HTTPS 地址不能包含凭据、查询参数或转义路径');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  )
    throw new Error('同步地址必须是 HTTPS，或局域网 HTTP 地址');
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(url.pathname))
    throw new Error('同步路径只能包含字母、数字、短横线和下划线');
  return url.origin + url.pathname.replace(/\/$/, '');
}

export function syncEndpoints(input: string | string[]): string[] {
  const values = typeof input === 'string' ? input.trim().split(/[\s,，;；]+/) : input;
  if (!values.length || values.length > 16) throw new Error('请填写 1–16 个同步地址');
  const endpoints = values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('同步地址不能为空');
    const address = value.trim();
    const ip = /^(\d+\.\d+\.\d+\.\d+)(:\d+)?$/.exec(address);
    return syncEndpoint(ip ? `http://${ip[1]}${ip[2] ?? ':49732'}` : address);
  });
  return [...new Set(endpoints)];
}
