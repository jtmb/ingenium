import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { QualificationError, READ_PATHS, boundedInteger, readResponse } from './qualification-transport.mjs';

/** Nearest-rank percentiles, with no claim that a small bounded sample establishes a speedup. */
export function summarize(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) {
    throw new QualificationError('INVALID_SAMPLES');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = fraction => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  return { count: sorted.length, minMs: sorted[0], maxMs: sorted.at(-1),
    p50Ms: rank(0.5), p95Ms: rank(0.95) };
}

/** Interleave direct/edge samples and alternate first target to limit fixed ordering bias. */
export async function compareApiLatency({
  authorityOrigin, edgeOrigin, headers = {}, path = READ_PATHS[0],
  iterations = 20, warmup = 2, expectedStatus = 200, maxDurationMs = 15_000, signal,
}) {
  boundedInteger(iterations, 1, 100); boundedInteger(warmup, 0, 10);
  boundedInteger(maxDurationMs, 1, 60_000); boundedInteger(expectedStatus, 100, 599);
  if (!READ_PATHS.includes(path)) throw new QualificationError('REQUEST_OUTSIDE_HARNESS');
  const targets = [
    { name: 'authority', origin: authorityOrigin, agent: new http.Agent({ keepAlive: true, maxSockets: 1 }), samples: [] },
    { name: 'edge', origin: edgeOrigin, agent: new http.Agent({ keepAlive: true, maxSockets: 1 }), samples: [] },
  ];
  const start = performance.now(); let firstFailure = null;
  try {
    for (let pair = -warmup; pair < iterations; pair++) {
      const ordered = Math.abs(pair) % 2 ? [...targets].reverse() : targets;
      for (const target of ordered) {
        if (signal?.aborted) { firstFailure = { code: 'REQUEST_ABORTED' }; break; }
        const remaining = Math.floor(maxDurationMs - (performance.now() - start));
        if (remaining < 1) { firstFailure = { code: 'TOTAL_BUDGET_EXHAUSTED' }; break; }
        const before = performance.now(); let response;
        try {
          response = await readResponse(target.origin, { path, headers, agent: target.agent,
            timeoutMs: Math.min(5000, remaining), signal });
          if (response.status !== expectedStatus) {
            firstFailure = { code: 'UNEXPECTED_STATUS', target: target.name, status: response.status }; break;
          }
          if (pair >= 0) target.samples.push(performance.now() - before);
        } catch (error) {
          firstFailure = { code: error instanceof QualificationError ? error.code : 'SAMPLE_FAILED', target: target.name };
          break;
        } finally { response?.body.fill(0); }
      }
      if (firstFailure) break;
    }
    return { schemaVersion: 1, kind: 'interleaved-api-latency', accepted: !firstFailure,
      iterations, warmup, expectedStatus, elapsedMs: performance.now() - start,
      clock: 'monotonic-performance.now', percentile: 'nearest-rank', concurrency: 1,
      connectionMode: 'one independent keep-alive agent per target',
      authority: targets[0].samples.length ? summarize(targets[0].samples) : null,
      edge: targets[1].samples.length ? summarize(targets[1].samples) : null,
      firstFailure };
  } finally { for (const target of targets) target.agent.destroy(); }
}

/** Readiness admits only the expected status; an auth denial may be chosen explicitly. */
export async function waitForReadiness({ origin, path = READ_PATHS[0], expectedStatus = 401,
  timeoutMs = 5000, pollMs = 25, signal, isExited = () => false }) {
  boundedInteger(timeoutMs, 1, 30_000); boundedInteger(pollMs, 1, 1000);
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (signal?.aborted) throw new QualificationError('READINESS_ABORTED');
    if (isExited()) throw new QualificationError('PROCESS_EXITED_BEFORE_READY');
    let response;
    try {
      const remaining = Math.max(1, Math.floor(timeoutMs - (performance.now() - started)));
      response = await readResponse(origin, { path, timeoutMs: Math.min(250, remaining), signal });
      if (response.status === expectedStatus) return;
    } catch (error) {
      if (!(error instanceof QualificationError)
          || !['TRANSPORT_FAILED', 'REQUEST_TIMEOUT', 'RESPONSE_INCOMPLETE'].includes(error.code)) throw error;
    } finally { response?.body.fill(0); }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, timeoutMs - (performance.now() - started)))));
  }
  throw new QualificationError('READINESS_TIMEOUT');
}

/**
 * Each launch owns one process. "Cold" means first new process; OS/filesystem caches are
 * uncontrolled. Never flush caches, stop another service, or call relaunch samples OS-cold.
 */
export async function measureStarts({ runs = 2, launch, ready, sampleIdle }) {
  boundedInteger(runs, 2, 5);
  const measurements = [];
  for (let index = 0; index < runs; index++) {
    const result = await launch(async ({ startedAt, child }) => {
      await ready(child);
      const startupMs = performance.now() - startedAt;
      const idle = await sampleIdle(child.pid);
      return { startupMs, idle };
    });
    measurements.push({ label: index === 0 ? 'first-process-start' : 'warm-process-relaunch',
      cacheState: 'OS-cache-uncontrolled', ...result });
    if (!result.ok) break;
  }
  return { schemaVersion: 1, kind: 'process-start-idle', runsRequested: runs,
    accepted: measurements.length === runs && measurements.every(item => item.ok), measurements };
}
