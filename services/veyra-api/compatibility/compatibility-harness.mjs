import { performance } from 'node:perf_hooks';
import { compareResponses } from './response-parity.mjs';
import { CONTEXT_HEADERS, READ_PATHS, QualificationError, boundedInteger, listenOwned, loopbackOrigin, readResponse } from './qualification-transport.mjs';

const DEFINITIONS = Object.freeze([
  { name: 'anonymous', slot: null, path: READ_PATHS[0], status: 401 },
  { name: 'session-projects', slot: 'session', path: READ_PATHS[0], status: 200 },
  { name: 'session-archive', slot: 'session', path: READ_PATHS[1], status: 200 },
  { name: 'bearer-projects', slot: 'bearer', path: READ_PATHS[0], status: 200 },
  { name: 'valid-cookie-invalid-bearer', slot: 'validCookieInvalidBearer', path: READ_PATHS[0], status: 200 },
  { name: 'invalid-cookie-valid-bearer', slot: 'invalidCookieValidBearer', path: READ_PATHS[0], status: 401 },
  { name: 'expired-session', slot: 'expiredSession', path: READ_PATHS[0], status: 401 },
  { name: 'revoked-session', slot: 'revokedSession', path: READ_PATHS[0], status: 401 },
  { name: 'private-marker', slot: 'session', path: READ_PATHS[0], extra: { 'x-ingenium-internal-service': '1' }, status: 404, hidden: true },
  { name: 'write-method', slot: 'session', path: READ_PATHS[0], method: 'POST', status: 404, hidden: true },
  { name: 'implicit-head', slot: 'session', path: READ_PATHS[0], method: 'HEAD', status: 404, hidden: true },
  { name: 'hidden-route', slot: 'session', path: '/api/v1/auth/preflight', status: 404, hidden: true },
]);

function credentialHeaders(credentials, definition) {
  const selected = definition.slot ? credentials[definition.slot] : {};
  if (!selected || typeof selected !== 'object') throw new QualificationError('CREDENTIAL_FIXTURE_MISSING');
  const headers = {};
  for (const [name, value] of Object.entries(selected)) {
    if (!CONTEXT_HEADERS.includes(name) || typeof value !== 'string' || value.length > 8192
        || value.includes('\r') || value.includes('\n')) throw new QualificationError('INVALID_CREDENTIAL_FIXTURE');
    headers[name] = value;
  }
  if (definition.slot && !headers.cookie && !headers.authorization) throw new QualificationError('CREDENTIAL_FIXTURE_MISSING');
  if (['session', 'expiredSession', 'revokedSession'].includes(definition.slot) && !headers.cookie) throw new QualificationError('CREDENTIAL_FIXTURE_MISSING');
  if (definition.slot === 'bearer' && !headers.authorization) throw new QualificationError('CREDENTIAL_FIXTURE_MISSING');
  if (definition.name.includes('cookie') && (!headers.cookie || !headers.authorization)) throw new QualificationError('CREDENTIAL_FIXTURE_MISSING');
  return { ...headers, ...definition.extra };
}

function sameCredentials(expected, received) {
  return CONTEXT_HEADERS.every(name => expected[name] === received[name]);
}

/**
 * Compare one edge request to the exact response from its original authoritative request.
 * withEdge must own its edge lifecycle and close it in finally. No credentials or body leave this result.
 */
export async function qualifyCompatibility({ authorityOrigin, credentials, withEdge, signal, maxDurationMs = 30_000 }) {
  const authority = loopbackOrigin(authorityOrigin);
  boundedInteger(maxDurationMs, 1, 60_000);
  if (signal?.aborted) throw new QualificationError('RUN_ABORTED');
  // Validate the entire matrix before any request: expiry/revocation are never silently skipped.
  const cases = DEFINITIONS.map(definition => ({ ...definition, headers: credentialHeaders(credentials, definition) }));
  let active;
  const recorder = await listenOwned(async (req, res) => {
    if (!active) { res.writeHead(404); res.end(); return; }
    const current = active;
    current.requests++;
    if (current.requests !== 1 || req.method !== 'GET' || !READ_PATHS.includes(req.url)
        || req.url !== current.path || !sameCredentials(current.headers, req.headers)) {
      current.requestMismatch = true;
      res.writeHead(502, { 'cache-control': 'no-store' }); res.end(); return;
    }
    try {
      const headers = Object.fromEntries(CONTEXT_HEADERS.filter(name => req.headers[name] !== undefined)
        .map(name => [name, req.headers[name]]));
      const original = await readResponse(authority, { path: req.url, headers, signal: current.controller.signal });
      current.original = original;
      // Preserve only the read edge's selected response headers; never relay Set-Cookie.
      const allowed = ['content-type', 'content-encoding', 'vary', 'www-authenticate',
        'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
      res.writeHead(original.status, Object.fromEntries(allowed.filter(name => original.headers[name] !== undefined)
        .map(name => [name, original.headers[name]])));
      res.end(original.body);
    } catch {
      current.upstreamFailure = true;
      res.writeHead(502, { 'cache-control': 'no-store' }); res.end();
    }
  });
  const results = [];
  try {
    await withEdge(recorder.origin, async (edgeOrigin, edgeSignal) => {
      const signals = [signal, edgeSignal].filter(Boolean);
      const combined = signals.length ? AbortSignal.any(signals) : undefined;
      const started = performance.now();
      loopbackOrigin(edgeOrigin);
      for (const entry of cases) {
        if (combined?.aborted || performance.now() - started >= maxDurationMs) {
          results.push({ name: entry.name, compatible: false, failureCode: combined?.aborted ? 'RUN_ABORTED' : 'TOTAL_BUDGET_EXHAUSTED', upstreamRequests: 0 });
          break;
        }
        active = { ...entry, requests: 0, original: null, requestMismatch: false, controller: new AbortController() };
        let actual;
        try {
          actual = await readResponse(edgeOrigin, { path: entry.path, method: entry.method ?? 'GET', headers: entry.headers, signal: combined,
            timeoutMs: Math.max(1, Math.min(5000, Math.floor(maxDurationMs - (performance.now() - started)))) });
          let mismatches = [];
          if (entry.hidden) {
            if (active.requests !== 0) mismatches.push('unexpected-upstream-request');
          } else if (active.requestMismatch || active.requests !== 1 || !active.original) {
            mismatches.push('original-request');
          } else {
            mismatches = [...compareResponses(active.original, actual).mismatches];
          }
          if (actual.status !== entry.status) mismatches.push('expected-status');
          results.push({ name: entry.name, status: actual.status, expectedStatus: entry.status,
            upstreamRequests: active.requests, compatible: mismatches.length === 0, mismatches });
        } catch (error) {
          results.push({ name: entry.name, compatible: false,
            failureCode: error instanceof QualificationError ? error.code : 'CASE_FAILED',
            upstreamRequests: active.requests });
        } finally {
          active.controller.abort(); actual?.body.fill(0); active.original?.body.fill(0); active = null;
        }
        if (combined?.aborted) break;
      }
    });
    if (!results.length) throw new QualificationError('EDGE_CALLBACK_NOT_EXECUTED');
    return { schemaVersion: 1, kind: 'same-request-compatibility',
      accepted: results.length === cases.length && results.every(result => result.compatible),
      completedCases: results.length, requiredCases: cases.length, cases: results };
  } finally {
    active?.controller.abort();
    active?.original?.body.fill(0);
    active = null;
    await recorder.close();
  }
}
