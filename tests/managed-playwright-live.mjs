import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

export function toolResultMetadata(result) {
  const text = JSON.stringify(result.content);
  return { isError: Boolean(result.isError), bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
}

export function discoveryNames(payload) {
  assert.ok(Array.isArray(payload.data), 'DISCOVERY_DATA_INVALID');
  return payload.data.map(tool => {
    assert.equal(typeof tool.canonical_name, 'string', 'DISCOVERY_NAME_INVALID');
    assert.ok(tool.canonical_name.startsWith('ingenium_playwright_'), 'DISCOVERY_NAMESPACE_INVALID');
    return tool.canonical_name;
  });
}

export function selectBrowserTool(tools, operation) {
  return tools.find(tool => tool.name === `playwright_browser_${operation}`)?.name;
}

export function browserCall(name, args) {
  return { name, arguments: { project: 'ingenium', arguments: args } };
}

export async function ownerApi() {
  const fd = openSync('.env', constants.O_RDONLY | constants.O_NOFOLLOW);
  let credentials;
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o600, 'PROTECTED_ENV_REQUIRED');
    credentials = parseEnv(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  const cookies = new Map();
  let csrf;
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`http://localhost:3000/api/v1${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { origin: 'http://localhost:3000', 'x-ingenium-ui': 'dashboard',
        'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    }
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  csrf = (await api('/auth/csrf')).body.data?.csrfToken;
  const login = await api('/auth/login', 'POST', { email: credentials.INGENIUM_DASHBOARD_EMAIL, password: credentials.INGENIUM_DASHBOARD_PASSWORD });
  credentials = undefined;
  assert.equal(login.status, 200, 'OWNER_LOGIN_FAILED');
  csrf = login.body.data.csrfToken;
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = await ownerApi();
  if (process.argv.includes('--lifecycle')) {
    assert.match(process.env.INGENIUM_ACCEPTANCE_CONTAINER ?? '', /^[a-f0-9]{12,64}$/, 'ACCEPTANCE_CONTAINER_REQUIRED');
    const emit = value => console.log(JSON.stringify(value));
    const list = await api('/mcp-servers?project=ingenium');
    assert.equal(list.status, 200);
    assert.ok(!list.body.data.some(server => server.name === 'playwright'), 'PRESET_NOT_ABSENT');
    emit({ stage: 'RATE_LIMIT_QUIESCENCE', seconds: 65 });
    await delay(65000);
    const runtime = spawn('docker', ['exec', '-i', '--user', '1105', '--workdir', '/workspace',
      process.env.INGENIUM_ACCEPTANCE_CONTAINER, 'node', '/workspace/ingenium/tests/local-runtime-live-acceptance.mjs', '--calls-only', '--wait'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
    runtime.stderr.on('data', () => {});
    const exited = new Promise(resolve => runtime.once('exit', resolve));
    let connected;
    const ready = new Promise(resolve => { connected = resolve; });
    createInterface({ input: runtime.stdout }).on('line', line => {
      const event = JSON.parse(line);
      emit(event);
      if (event.stage === 'MCP_CONNECTED') connected(true);
      if (event.failure) connected(false);
    });
    let preset = false;
    try {
      assert.equal(await Promise.race([ready, exited.then(() => false), delay(60000).then(() => false)]), true, 'MCP_CONNECTION_FAILED');
      const absent = await api('/mcp-servers?project=ingenium');
      assert.ok(!absent.body.data.some(server => server.name === 'playwright'));
      emit({ stage: 'PRESET_ABSENT', status: absent.status });
      const created = await api('/mcp-servers/presets/playwright?project=ingenium', 'POST', {});
      preset = created.status === 201;
      emit({ stage: 'PRESET_CREATE', status: created.status });
      assert.ok(preset);
      const refresh = await api('/mcp-servers/playwright/refresh?project=ingenium', 'POST', {});
      emit({ stage: 'PRESET_REFRESH', status: refresh.status });
      assert.equal(refresh.status, 200);
      let names = [];
      for (let poll = 0; poll < 12; poll++) {
        const tools = await api('/mcp-servers/playwright/tools?project=ingenium');
        assert.equal(tools.status, 200);
        names = discoveryNames(tools.body);
        if (names.length) break;
        await delay(5000);
      }
      emit({ stage: 'DISCOVERY', count: names.length, names });
      assert.equal(names.length, 30, 'DISCOVERY_COUNT_MISMATCH');
      assert.equal(new Set(names).size, 30, 'DISCOVERY_NAMES_NOT_UNIQUE');
      const status = await api('/mcp-servers/status?project=ingenium');
      assert.equal(status.status, 200);
      assert.equal(status.body.data.find(server => server.name === 'playwright')?.discovery_status, 'ready');
      emit({ stage: 'DISCOVERY_READY', ready: true });
      for (const operation of ['navigate', 'snapshot', 'close']) {
        const name = `ingenium_playwright_browser_${operation}`;
        const before = await api(`/mcp-tools/${name}/state?project=ingenium`);
        assert.equal(before.status, 200);
        assert.equal(before.body.data.enabled, true, 'PASSIVE_TOOL_NOT_ENABLED');
        const after = await api(`/mcp-tools/${name}/state?project=ingenium`);
        emit({ stage: 'ENABLEMENT', name, before: before.body.data.enabled, after: after.body.data.enabled, changed: !before.body.data.enabled });
        assert.equal(after.body.data.enabled, true);
      }
      runtime.stdin.end('run\n');
      assert.equal(await exited, 0, 'BROWSER_LIFECYCLE_FAILED');
    } finally {
      runtime.stdin.end();
      if (preset) {
        const removed = await api('/mcp-servers/playwright?project=ingenium', 'DELETE');
        emit({ stage: 'PRESET_DELETE', status: removed.status });
        assert.equal(removed.status, 204);
      }
      const residual = await api('/mcp-servers?project=ingenium');
      emit({ stage: 'PRESET_RESIDUAL', status: residual.status, present: residual.body.data.some(server => server.name === 'playwright') });
      assert.ok(!residual.body.data.some(server => server.name === 'playwright'));
    }
  } else {
  for (const path of ['/mcp-servers/playwright/tools', '/mcp-servers/status', '/mcp-tools', '/opencode/mcp']) {
    const result = await api(`${path}?project=ingenium`);
    const data = path === '/mcp-tools' ? result.body.data?.filter(tool => tool.tool_name.includes('playwright'))
      : path === '/opencode/mcp' ? { ingenium: result.body.data?.ingenium?.status } : result.body;
    console.log(JSON.stringify({ path, status: result.status, data }));
  }
  }
}
