import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResponses } from '../compatibility/response-parity.mjs';
import { qualifyCompatibility } from '../compatibility/compatibility-harness.mjs';
import { listenOwned, readResponse, loopbackOrigin, READ_PATHS, CONTEXT_HEADERS } from '../compatibility/qualification-transport.mjs';
import { compareApiLatency, summarize, waitForReadiness } from '../compatibility/performance-harness.mjs';

const credentials = {
  session: { cookie: '__Host-ingenium_session=synthetic-secret-valid' },
  bearer: { authorization: 'Bearer synthetic-secret-valid' },
  validCookieInvalidBearer: { cookie: '__Host-ingenium_session=synthetic-secret-valid', authorization: 'Bearer synthetic-secret-invalid' },
  invalidCookieValidBearer: { cookie: '__Host-ingenium_session=synthetic-secret-invalid', authorization: 'Bearer synthetic-secret-valid' },
  expiredSession: { cookie: '__Host-ingenium_session=synthetic-secret-expired' },
  revokedSession: { cookie: '__Host-ingenium_session=synthetic-secret-revoked' },
};

async function fixtureAuthority() {
  let requests = 0;
  const fixture = await listenOwned((req, res) => {
    requests++;
    const cookie = req.headers.cookie;
    const valid = cookie ? cookie.endsWith('=synthetic-secret-valid')
      : req.headers.authorization === 'Bearer synthetic-secret-valid';
    res.writeHead(valid ? 200 : 401, { 'content-type': 'application/json',
      'cache-control': 'no-store', 'www-authenticate': 'Bearer realm="ingenium"' });
    res.end(JSON.stringify(valid ? { data: [{ private: 'synthetic-body-do-not-log', request: requests }] }
      : { error: { code: 'UNAUTHORIZED', requestId: 'changing-' + requests } }));
  });
  return { ...fixture, count: () => requests };
}

async function withFixtureEdge(upstream, callback, { corruptCredential = false } = {}) {
  const edge = await listenOwned(async (req, res) => {
    if (req.method !== 'GET' || !READ_PATHS.includes(req.url) || req.headers['x-ingenium-internal-service']) {
      res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return;
    }
    const headers = Object.fromEntries(CONTEXT_HEADERS.filter(name => req.headers[name] !== undefined)
      .map(name => [name, req.headers[name]]));
    if (corruptCredential) headers.authorization = 'Bearer tampered-synthetic-secret';
    const result = await readResponse(upstream, { path: req.url, headers });
    res.writeHead(result.status, { ...result.headers, 'cache-control': 'no-store' });
    res.end(result.body);
  });
  try { return await callback(edge.origin); } finally { await edge.close(); }
}

test('full synthetic auth matrix uses one exact authoritative request, with zero hidden-route forwarding', async () => {
  const authority = await fixtureAuthority();
  try {
    const result = await qualifyCompatibility({ authorityOrigin: authority.origin, credentials,
      withEdge: (origin, exercise) => withFixtureEdge(origin, exercise) });
    assert.equal(result.accepted, true);
    assert.equal(result.cases.length, 12);
    assert.equal(authority.count(), 8);
    assert.ok(result.cases.slice(8).every(item => item.upstreamRequests === 0 && item.status === 404));
    const encoded = JSON.stringify(result);
    for (const privateValue of ['synthetic-secret', 'synthetic-body-do-not-log', 'changing-', 'authorization', '__Host']) {
      assert.equal(encoded.includes(privateValue), false);
    }
  } finally { await authority.close(); }
});

test('changed original credentials fail before reaching the authoritative writer, with no fallback', async () => {
  const authority = await fixtureAuthority();
  try {
    const result = await qualifyCompatibility({ authorityOrigin: authority.origin, credentials,
      withEdge: (origin, exercise) => withFixtureEdge(origin, exercise, { corruptCredential: true }) });
    assert.equal(result.accepted, false);
    assert.equal(authority.count(), 0);
    assert.ok(result.cases.slice(0, 8).every(item => item.mismatches.includes('original-request')));
  } finally { await authority.close(); }
});

test('missing expiry/revocation fixtures refuse the run before creating an edge or sending traffic', async () => {
  let launched = false;
  await assert.rejects(qualifyCompatibility({ authorityOrigin: 'http://127.0.0.1:1', credentials: {},
    withEdge: () => { launched = true; } }), /CREDENTIAL_FIXTURE_MISSING/);
  assert.equal(launched, false);
});

test('recorder closes even when its edge launcher fails', async () => {
  let origin;
  await assert.rejects(qualifyCompatibility({ authorityOrigin: 'http://127.0.0.1:1', credentials,
    withEdge: async recorder => { origin = recorder; throw new Error('fixture startup failed'); } }), /fixture startup failed/);
  await assert.rejects(readResponse(origin), /TRANSPORT_FAILED|REQUEST_TIMEOUT/);
});

test('raw transport keeps encoded bytes, bounds oversized responses and times out owned hanging fixtures', async () => {
  const encoded = Buffer.from([31, 139, 8, 0, 0, 255]);
  const fixture = await listenOwned((req, res) => {
    if (req.url === READ_PATHS[1]) return;
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(encoded);
  });
  try {
    const result = await readResponse(fixture.origin);
    assert.deepEqual(result.body, encoded);
    assert.equal(compareResponses(result, result).compatible, true);
    result.body.fill(0);
    await assert.rejects(readResponse(fixture.origin, { maxBytes: 2 }), /RESPONSE_TOO_LARGE/);
    await assert.rejects(readResponse(fixture.origin, { path: READ_PATHS[1], timeoutMs: 20 }), /REQUEST_TIMEOUT/);
  } finally { await fixture.close(); }
});

test('remote origins, credential URLs and arbitrary request targets are refused', () => {
  for (const origin of ['https://example.test', 'http://localhost:4097', 'http://user:private@127.0.0.1:4097',
    'http://127.0.0.1:4097/private', 'http://127.0.0.1:4097/?token=private']) {
    assert.throws(() => loopbackOrigin(origin), /INVALID_ORIGIN/);
  }
  assert.throws(() => readResponse('http://127.0.0.1:1', { path: '/api/v1/vault' }), /REQUEST_OUTSIDE_HARNESS/);
});

test('nearest-rank metrics handle small bounded samples and reject invalid data', () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), { count: 4, minMs: 1, maxMs: 4, p50Ms: 2, p95Ms: 4 });
  assert.throws(() => summarize([]), /INVALID_SAMPLES/);
  assert.throws(() => summarize([NaN]), /INVALID_SAMPLES/);
});

test('paired latency samples alternate authority/edge, include warmup and retain only numeric metrics', async () => {
  const order = [];
  const authority = await listenOwned((_req, res) => { order.push('authority'); res.end('private-synthetic-body'); });
  const edge = await listenOwned((_req, res) => { order.push('edge'); res.end('private-synthetic-body'); });
  try {
    const result = await compareApiLatency({ authorityOrigin: authority.origin, edgeOrigin: edge.origin,
      iterations: 4, warmup: 1 });
    assert.equal(result.accepted, true);
    assert.equal(result.authority.count, 4); assert.equal(result.edge.count, 4);
    assert.deepEqual(order.slice(0, 6), ['edge', 'authority', 'authority', 'edge', 'edge', 'authority']);
    assert.ok(result.edge.p95Ms >= result.edge.p50Ms);
    assert.equal(JSON.stringify(result).includes('private-synthetic-body'), false);
    await assert.rejects(compareApiLatency({ authorityOrigin: authority.origin, edgeOrigin: edge.origin, iterations: 101 }), /INVALID_BUDGET/);
  } finally { await edge.close(); await authority.close(); }
});

test('unexpected auth status preserves the first failed sample without retrying or claiming a speed result', async () => {
  let requests = 0;
  const authority = await listenOwned((_req, res) => { requests++; res.writeHead(401); res.end('private-denial'); });
  try {
    const result = await compareApiLatency({ authorityOrigin: authority.origin, edgeOrigin: authority.origin,
      iterations: 5, warmup: 0 });
    assert.equal(result.accepted, false);
    assert.deepEqual(result.firstFailure, { code: 'UNEXPECTED_STATUS', target: 'authority', status: 401 });
    assert.equal(requests, 1); assert.equal(result.authority, null); assert.equal(result.edge, null);
  } finally { await authority.close(); }
});

test('readiness respects process exit and explicit authentication status', async () => {
  await assert.rejects(waitForReadiness({ origin: 'http://127.0.0.1:1', isExited: () => true }), /PROCESS_EXITED_BEFORE_READY/);
  const fixture = await listenOwned((_req, res) => { res.writeHead(401); res.end(); });
  try { await waitForReadiness({ origin: fixture.origin, expectedStatus: 401 }); }
  finally { await fixture.close(); }
});

test('aborting a pending request closes its owned socket without an unbounded fixture wait', async () => {
  const fixture = await listenOwned(() => {});
  const controller = new AbortController();
  try {
    const request = readResponse(fixture.origin, { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, /REQUEST_ABORTED/);
    await assert.rejects(readResponse(fixture.origin, { signal: controller.signal }), /REQUEST_ABORTED/);
  } finally { await fixture.close(); }
});

test('an aborted matrix refuses traffic before any recorder or edge is launched', async () => {
  const controller = new AbortController(); controller.abort();
  let launched = false;
  await assert.rejects(qualifyCompatibility({ authorityOrigin: 'http://127.0.0.1:1', credentials,
    signal: controller.signal, withEdge: () => { launched = true; } }), /RUN_ABORTED/);
  assert.equal(launched, false);
});
