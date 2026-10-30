import http from 'node:http';
import { once } from 'node:events';

export const READ_PATHS = Object.freeze(['/api/v1/projects', '/api/v1/projects/archive']);
export const CONTEXT_HEADERS = Object.freeze([
  'authorization', 'cookie', 'origin', 'x-ingenium-ui',
  'x-ingenium-audience', 'x-ingenium-workspace', 'x-ingenium-launcher-worktree',
]);

export class QualificationError extends Error {
  constructor(code) { super(code); this.name = 'QualificationError'; this.code = code; }
}

export function loopbackOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new QualificationError('INVALID_ORIGIN'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new QualificationError('INVALID_ORIGIN');
  }
  return url.origin;
}

export function boundedInteger(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new QualificationError('INVALID_BUDGET');
  return value;
}

/** Raw HTTP bytes: fetch's implicit decompression cannot prove opaque-byte parity. */
export function readResponse(origin, {
  path = READ_PATHS[0], method = 'GET', headers = {}, timeoutMs = 5000,
  maxBytes = 4 * 1024 * 1024, agent = false, signal,
} = {}) {
  const base = loopbackOrigin(origin);
  if (![...READ_PATHS, '/api/v1/auth/preflight'].includes(path)
      || !['GET', 'POST', 'HEAD'].includes(method)) throw new QualificationError('REQUEST_OUTSIDE_HARNESS');
  boundedInteger(timeoutMs, 1, 30_000); boundedInteger(maxBytes, 1, 4 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0; let settled = false;
    const fail = (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      for (const chunk of chunks) chunk.fill(0);
      request.destroy();
      reject(new QualificationError(code));
    };
    const request = http.request(base + path, { method, headers, agent }, (response) => {
      // No redirect is followed, and incomplete/over-budget responses never become successful samples.
      response.on('data', chunk => {
        if (settled) return;
        length += chunk.length;
        if (length > maxBytes) { chunk.fill(0); fail('RESPONSE_TOO_LARGE'); }
        else chunks.push(chunk);
      });
      response.on('aborted', () => fail('RESPONSE_INCOMPLETE'));
      response.on('error', () => fail('RESPONSE_INCOMPLETE'));
      response.on('end', () => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
        const body = Buffer.concat(chunks);
        for (const chunk of chunks) chunk.fill(0);
        resolve({ status: response.statusCode, headers: response.headers, body });
      });
    });
    request.on('error', () => fail('TRANSPORT_FAILED'));
    const timer = setTimeout(() => fail('REQUEST_TIMEOUT'), timeoutMs);
    const aborted = () => fail('REQUEST_ABORTED');
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    request.end();
  });
}

/** Own only this loopback fixture's sockets; shutdown does not inspect or stop other workloads. */
export async function listenOwned(handler) {
  const sockets = new Set(); let closed = false;
  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(502, { 'cache-control': 'no-store' });
      res.end();
    });
  });
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch { server.close(); throw new QualificationError('FIXTURE_LISTEN_FAILED'); }
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin,
    async close() {
      if (closed) return;
      closed = true;
      const done = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await done;
    },
  };
}
