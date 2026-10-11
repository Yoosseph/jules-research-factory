import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { styleHash } from './layout.mjs';

export function safeEqual(a, b) {
  const x = Buffer.from(a ?? '');
  const y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function html(response, body, status = 200) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'self'; style-src 'sha256-${styleHash}'; font-src 'self'; script-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
  response.end(body);
}

export function redirect(response, path) {
  response.writeHead(303, { location: path, 'cache-control': 'no-store' });
  response.end();
}

export const messageUrl = (path, message, type = 'message') => `${path}${path.includes('?') ? '&' : '?'}${type}=${encodeURIComponent(message)}`;
export const selectionUrl = ids => `/preflight?${ids.map(id => `id=${encodeURIComponent(id)}`).join('&')}`;

export async function bodyParams(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error('Form is too large.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function idsFrom(value) {
  const ids = value.getAll('projectId').length ? value.getAll('projectId') : value.getAll('id');
  if (!ids.length || ids.length > 50 || ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('Select 1–50 valid projects.');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate project IDs are not allowed.');
  return ids;
}

const assets = new Map([
  ['/style.css', 'text/css; charset=utf-8', 'no-store'],
  ['/favicon.svg', 'image/svg+xml', 'no-store'],
  ['/favicon-dark.svg', 'image/svg+xml', 'no-store'],
  ['/interface.js', 'text/javascript; charset=utf-8'],
  ['/flow.js', 'text/javascript; charset=utf-8'],
  ['/theme.js', 'text/javascript; charset=utf-8'],
  ['/fonts/fraunces.ttf', 'font/ttf'],
  ['/fonts/fraunces-italic.ttf', 'font/ttf'],
  ['/fonts/manrope.ttf', 'font/ttf'],
].map(([path, type, cache = 'no-cache']) => [path, { type, cache }]));

export function serveAsset(request, response, path) {
  if (request.method !== 'GET' || !assets.has(path)) return false;
  const { type, cache } = assets.get(path);
  const file = readFileSync(join(import.meta.dirname, '..', 'public', path.slice(1)));
  response.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  response.end(file);
  return true;
}
