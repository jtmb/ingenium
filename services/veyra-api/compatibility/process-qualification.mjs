import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { QualificationError, boundedInteger } from './qualification-transport.mjs';

const execute = promisify(execFile);

export async function sha256File(path) {
  const hash = createHash('sha256');
  try { for await (const chunk of createReadStream(path)) hash.update(chunk); }
  catch { throw new QualificationError('ARTIFACT_UNREADABLE'); }
  return hash.digest('hex');
}

/** The expected build-to-source binding comes from the coordinator's actual build receipt. */
export async function verifyExactSourceArtifact({ sourceRoot, expectedCommit, artifactPath, expectedBinarySha256, scriptArtifact, gitCommand = { file: 'git', prefix: [] } }) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '') || !/^[a-f0-9]{64}$/.test(expectedBinarySha256 ?? '')
      || !isAbsolute(sourceRoot ?? '') || !isAbsolute(artifactPath ?? '')) {
    throw new QualificationError('INVALID_SOURCE_IDENTITY');
  }
  if (['node', 'node.exe'].includes(basename(artifactPath).toLowerCase()) && !scriptArtifact) {
    throw new QualificationError('SCRIPT_ARTIFACT_REQUIRED');
  }
  if (!gitCommand || typeof gitCommand.file !== 'string' || !Array.isArray(gitCommand.prefix)
      || gitCommand.prefix.some(value => typeof value !== 'string')) throw new QualificationError('INVALID_GIT_BRIDGE');
  let head, status;
  try {
    [head, status] = await Promise.all([
      execute(gitCommand.file, [...gitCommand.prefix, '-C', sourceRoot, 'rev-parse', 'HEAD'], { windowsHide: true, maxBuffer: 1024 }),
      execute(gitCommand.file, [...gitCommand.prefix, '-C', sourceRoot, 'status', '--porcelain'], { windowsHide: true, maxBuffer: 65536 }),
    ]);
  } catch { throw new QualificationError('SOURCE_IDENTITY_UNAVAILABLE'); }
  if (head.stdout.trim() !== expectedCommit || status.stdout !== '') throw new QualificationError('SOURCE_NOT_EXACT');
  const binarySha256 = await sha256File(artifactPath);
  if (binarySha256 !== expectedBinarySha256) throw new QualificationError('ARTIFACT_HASH_MISMATCH');
  const scriptSha256 = await verifyScript(scriptArtifact);
  return { sourceCommit: expectedCommit, binarySha256, ...(scriptSha256 ? { scriptSha256 } : {}), sourceClean: true,
    buildBinding: 'expected source/binary binding supplied by coordinator build receipt' };
}

async function verifyScript(scriptArtifact) {
  if (!scriptArtifact) return null;
  if (!isAbsolute(scriptArtifact.path ?? '') || !/^[a-f0-9]{64}$/.test(scriptArtifact.sha256 ?? '')) {
    throw new QualificationError('INVALID_SCRIPT_ARTIFACT');
  }
  if (await sha256File(scriptArtifact.path) !== scriptArtifact.sha256) throw new QualificationError('SCRIPT_HASH_MISMATCH');
  return scriptArtifact.sha256;
}

function exited(child) { return child.exitCode !== null || child.signalCode !== null; }

async function boundedClose(child, closed, graceMs) {
  if (!exited(child)) child.kill('SIGTERM');
  let timer;
  let done = await Promise.race([
    closed.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), graceMs); }),
  ]);
  clearTimeout(timer);
  if (!done && !exited(child)) {
    child.kill('SIGKILL');
    done = await Promise.race([
      closed.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), graceMs); }),
    ]);
    clearTimeout(timer);
  }
  return { pid: child.pid ?? null, closed: done, exitCode: child.exitCode, signal: child.signalCode };
}

/** Stop only the newly spawned direct child, including callback failure and signal/null-exitCode. */
export async function withOwnedProcess({ file, args = [], cwd, env = process.env,
  expectedExecutableSha256, scriptArtifact, ipc = false, shutdownMs = 2000, callbackTimeoutMs = 30_000 }, callback) {
  if (!isAbsolute(file ?? '') || !isAbsolute(cwd ?? '') || !Array.isArray(args)
      || args.some(value => typeof value !== 'string') || !/^[a-f0-9]{64}$/.test(expectedExecutableSha256 ?? '')) {
    throw new QualificationError('INVALID_PROCESS_SPEC');
  }
  boundedInteger(shutdownMs, 1, 5000); boundedInteger(callbackTimeoutMs, 1, 60_000);
  const executable = await realpath(file).catch(() => { throw new QualificationError('ARTIFACT_UNREADABLE'); });
  if (await sha256File(executable) !== expectedExecutableSha256) throw new QualificationError('ARTIFACT_HASH_MISMATCH');
  const scriptSha256 = await verifyScript(scriptArtifact);
  if (scriptArtifact && args[0] !== scriptArtifact.path) throw new QualificationError('SCRIPT_ENTRYPOINT_NOT_EXECUTED');
  const startedAt = performance.now();
  const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
  let stdoutBytes = 0; let stderrBytes = 0;
  child.stdout.on('data', chunk => { stdoutBytes += chunk.length; });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  // Install close/error observers before spawn/exit can fire.
  const closed = new Promise(resolve => child.once('close', resolve));
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new QualificationError('PROCESS_SPAWN_FAILED')));
  });
  let value; let firstFailure = null; let cleanup; let callbackTimer;
  const controller = new AbortController();
  try {
    await spawned;
    value = await Promise.race([
      callback({ child, startedAt, isExited: () => exited(child), signal: controller.signal }),
      new Promise((_resolve, reject) => { callbackTimer = setTimeout(() => reject(new QualificationError('PROCESS_CALLBACK_TIMEOUT')), callbackTimeoutMs); }),
    ]);
  } catch (error) {
    firstFailure = error instanceof QualificationError ? error.code : 'PROCESS_CALLBACK_FAILED';
  } finally {
    clearTimeout(callbackTimer); controller.abort();
    try { cleanup = await boundedClose(child, closed, shutdownMs); }
    catch { cleanup = { pid: child.pid ?? null, closed: false, exitCode: child.exitCode, signal: child.signalCode }; }
  }
  return { ok: !firstFailure && cleanup.closed, artifactSha256: expectedExecutableSha256, ...(scriptSha256 ? { scriptSha256 } : {}), value, firstFailure,
    cleanup, cleanupFailure: cleanup.closed ? null : 'OWNED_PROCESS_NOT_CLOSED', output: { stdoutBytes, stderrBytes, contentsRetained: false } };
}

function validPid(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw new QualificationError('INVALID_PROCESS_ID');
}

/** Query only the owned PID; start identity detects replacement between samples. */
export async function sampleProcess(pid) {
  validPid(pid);
  try {
    if (process.platform === 'linux') {
      const [stat, status, ticks] = await Promise.all([
        readFile('/proc/' + pid + '/stat', 'utf8'), readFile('/proc/' + pid + '/status', 'utf8'),
        execute('getconf', ['CLK_TCK'], { timeout: 3000, maxBuffer: 256 }),
      ]);
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      const rss = status.split('\n').find(line => line.startsWith('VmRSS:'));
      const ticksPerSecond = Number(ticks.stdout.trim());
      if (!rss || !Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) throw new Error();
      return { pid, identity: fields[19], rssBytes: Number(rss.match(/\d+/)[0]) * 1024,
        cpuMs: (Number(fields[11]) + Number(fields[12])) / ticksPerSecond * 1000 };
    }
    if (process.platform === 'win32') {
      const command = "$ErrorActionPreference='Stop'; $p=Get-Process -Id " + pid
        + "; @{pid=$p.Id; identity=$p.StartTime.ToUniversalTime().Ticks.ToString(); rssBytes=$p.WorkingSet64; cpuMs=$p.TotalProcessorTime.TotalMilliseconds} | ConvertTo-Json -Compress";
      const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, timeout: 5000, maxBuffer: 2048 });
      const value = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
      if (value.pid !== pid || !Number.isFinite(value.rssBytes) || !Number.isFinite(value.cpuMs)) throw new Error();
      return value;
    }
    throw new QualificationError('PLATFORM_SAMPLER_UNAVAILABLE');
  } catch (error) {
    if (error instanceof QualificationError) throw error;
    throw new QualificationError('PROCESS_SAMPLE_UNAVAILABLE');
  }
}

/** CPU percentage is one-core equivalent, unnormalized; sampler overhead and elapsed time are explicit. */
export async function measureIdle(pid, { durationMs = 1000, sample = sampleProcess } = {}) {
  boundedInteger(durationMs, 10, 10_000);
  const started = performance.now();
  const before = await sample(pid);
  await new Promise(resolve => setTimeout(resolve, durationMs));
  const after = await sample(pid);
  const elapsedMs = performance.now() - started;
  if (before.pid !== pid || after.pid !== pid || before.identity !== after.identity
      || !Number.isFinite(after.cpuMs - before.cpuMs) || after.cpuMs < before.cpuMs
      || ![before.rssBytes, after.rssBytes].every(value => Number.isFinite(value) && value >= 0)) {
    throw new QualificationError('PROCESS_IDENTITY_CHANGED');
  }
  return { pid, durationRequestedMs: durationMs, elapsedMs, rssBeforeBytes: before.rssBytes,
    rssAfterBytes: after.rssBytes, cpuDeltaMs: after.cpuMs - before.cpuMs,
    cpuPercentOneCore: (after.cpuMs - before.cpuMs) / elapsedMs * 100,
    scope: 'owned direct process only; child processes excluded',
    sampler: process.platform === 'win32' ? 'Get-Process by PID' : 'procfs by PID plus CLK_TCK' };
}
