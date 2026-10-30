import http from 'node:http';
import { CONTEXT_HEADERS, READ_PATHS, readResponse } from '../../compatibility/qualification-transport.mjs';

if (process.env.VEYRA_QUALIFICATION_FIXTURE_EXIT === '1') process.exit(7);
const server = http.createServer(async (req, res) => {
  const upstream = process.env.VEYRA_QUALIFICATION_FIXTURE_UPSTREAM;
  if (!upstream) { res.writeHead(200); res.end('synthetic-response'); return; }
  if (req.method !== 'GET' || !READ_PATHS.includes(req.url) || req.headers['x-ingenium-internal-service']) {
    res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return;
  }
  try {
    const headers = Object.fromEntries(CONTEXT_HEADERS.filter(name => req.headers[name] !== undefined)
      .map(name => [name, req.headers[name]]));
    const result = await readResponse(upstream, { path: req.url, headers });
    res.writeHead(result.status, { ...result.headers, 'cache-control': 'no-store' }); res.end(result.body);
  } catch { res.writeHead(502, { 'cache-control': 'no-store' }); res.end(); }
});
server.listen(0, '127.0.0.1', () => {
  if (process.send) process.send({ origin: 'http://127.0.0.1:' + server.address().port });
});
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
