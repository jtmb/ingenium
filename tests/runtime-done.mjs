import { chromium } from 'playwright';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withMcpClient, mcpToolData } from '../packages/ingenium-extension/dist/mcp-client.js';
import { discoveryNames, selectBrowserTool, browserCall } from './managed-playwright-live.mjs';

delete process.env.DEBUG;
delete process.env.PWDEBUG;
const origin = 'http://localhost:3000';
const project = 'ingenium';
const workspaceId = 'shared-memory-ingenium';
const directory = `tests/artifacts/visual-qa/runtime-${Date.now()}-done`;
const marker = `synthetic-${randomUUID()}`;
const emit = data => console.log(JSON.stringify(data));
const requireGate = (condition, tag) => { if (!condition) throw new Error(tag); };
let browser, context, csrf, memory, preset = false, stage = 'AUTH';
async function api(path, method = 'GET', data) {
  const response = await context.request.fetch(`${origin}/api/v1${path}`, {
    method, data, timeout: 30000, maxRedirects: 0,
    headers: { origin, 'x-ingenium-ui': 'dashboard', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
  });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
async function presence(content, expected) {
  const result = await api(`/memory?project=${project}&workspaceId=${workspaceId}`);
  const present = result.body.data?.items?.some(item => item.memory.content === content) ?? false;
  emit({ gate: 'memory', surface: 'API-list', content, status: result.status, present });
  requireGate(result.status === 200 && present === expected, 'MEMORY_API_PRESENCE_FAILED');
  await withMcpClient(process.cwd(), async client => {
    for (const name of ['memory_list', 'memory_search']) {
      const response = await client.callTool({ name, arguments: { project, workspaceId, ...(name.endsWith('search') ? { query: content } : {}) } });
      const found = JSON.stringify(mcpToolData(response)).includes(content);
      emit({ gate: 'memory', surface: `bridge-${name}`, content, isError: Boolean(response.isError), present: found });
      requireGate(!response.isError && found === expected, 'MEMORY_BRIDGE_PRESENCE_FAILED');
    }
  }, { project, credentialPurpose: 'general', timeoutMs: 60000 });
}
try {
  const fd = openSync('.env', constants.O_RDONLY | constants.O_NOFOLLOW);
  let credentials;
  try {
    const stat = fstatSync(fd);
    requireGate(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o600, 'PROTECTED_ENV_REQUIRED');
    credentials = parseEnv(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  browser = await chromium.launch({ executablePath: '/home/brajam/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  csrf = (await api('/auth/csrf')).body.data?.csrfToken;
  const login = await api('/auth/login', 'POST', { email: credentials.INGENIUM_DASHBOARD_EMAIL, password: credentials.INGENIUM_DASHBOARD_PASSWORD });
  credentials = undefined;
  emit({ gate: 'login', status: login.status });
  requireGate(login.status === 200, 'LOGIN_FAILED');
  csrf = login.body.data.csrfToken;
  stage = 'RUNTIME';
  const workspaces = await api('/runtimes/browser/workspaces?project=ingenium');
  emit({ gate: 'workspaces', status: workspaces.status, data: workspaces.body.data });
  requireGate(workspaces.status === 200 && JSON.stringify(workspaces.body.data).includes(workspaceId), 'WORKSPACES_EMPTY_OR_UNBOUND');
  const runtime = await api('/runtimes/browser/status?project=ingenium');
  emit({ gate: 'browser-status', status: runtime.status, data: runtime.body.data });
  requireGate(runtime.status === 200 && runtime.body.data?.mode === 'compatibility' && runtime.body.data?.status === 'ready', 'BROWSER_RUNTIME_NOT_READY');
  const mcp = await api('/opencode/mcp?project=ingenium');
  emit({ gate: 'mcp', status: mcp.status, ingenium: mcp.body.data?.ingenium?.status });
  requireGate(mcp.status === 200 && mcp.body.data?.ingenium?.status === 'connected', 'INGENIUM_MCP_NOT_CONNECTED');
  stage = 'PRESET';
  const existing = await api('/mcp-servers?project=ingenium');
  requireGate(existing.status === 200 && !existing.body.data.some(server => server.name === 'playwright'), 'PRESET_ALREADY_EXISTS');
  const created = await api('/mcp-servers/presets/playwright?project=ingenium', 'POST', {});
  preset = created.status === 201;
  emit({ gate: 'preset-create', status: created.status });
  requireGate(preset, 'PRESET_CREATE_FAILED');
  stage = 'MEMORY_CHAT';
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/chat?project=ingenium`, { waitUntil: 'networkidle' });
  const controls = ['Use saved memory', 'Save this message to memory'];
  for (const name of controls) {
    const control = page.getByRole('button', { name, exact: true });
    await control.waitFor();
    emit({ gate: 'chat-control', name, enabled: await control.isEnabled() });
    requireGate(await control.isEnabled(), 'CHAT_MEMORY_CONTROLS_DISABLED');
  }
  await page.getByRole('button', { name: controls[1], exact: true }).click();
  await page.locator('textarea').fill(marker);
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/memory' && response.request().method() === 'POST');
  await page.locator('textarea').press('Enter');
  const saved = await savedResponse;
  memory = (await saved.json()).data?.memory;
  emit({ gate: 'memory', surface: 'chat-save', status: saved.status(), created: Boolean(memory) });
  requireGate(saved.status() === 201 && memory, 'CHAT_MEMORY_SAVE_FAILED');
  await presence(marker, true);
  const updated = await api(`/memory/${memory.id}?project=ingenium`, 'PATCH', { workspaceId, operationId: randomUUID(), expectedVersion: memory.version, content: `${marker}-v2` });
  memory = updated.body.data?.memory ?? memory;
  emit({ gate: 'memory-update', status: updated.status });
  requireGate(updated.status === 200, 'MEMORY_UPDATE_FAILED');
  await presence(`${marker}-v2`, true);
  const forgotten = await api(`/memory/${memory.id}?project=ingenium`, 'DELETE', { workspaceId, operationId: randomUUID(), expectedVersion: memory.version });
  emit({ gate: 'memory-forget', status: forgotten.status });
  requireGate(forgotten.status === 200, 'MEMORY_FORGET_FAILED');
  memory = undefined;
  await presence(marker, false);
  await presence(`${marker}-v2`, false);
  stage = 'PLAYWRIGHT';
  const refresh = await api('/mcp-servers/playwright/refresh?project=ingenium', 'POST', {});
  emit({ gate: 'preset-refresh', status: refresh.status });
  let names = [];
  for (let poll = 0; poll < 4; poll++) {
    await delay(5500);
    const tools = await api('/mcp-servers/playwright/tools?project=ingenium');
    names = discoveryNames(tools.body);
    emit({ gate: 'playwright-discovery', poll, status: tools.status, count: names.length, names });
    if (names.length) break;
  }
  if (names.length) {
    await withMcpClient(process.cwd(), async client => {
      const tools = (await client.listTools()).tools;
      const select = suffix => selectBrowserTool(tools, suffix.slice('browser_'.length));
      requireGate(select('browser_navigate') && select('browser_snapshot') && select('browser_close'), 'PLAYWRIGHT_BRIDGE_TOOLS_MISSING');
      try {
        for (const [suffix, args] of [['browser_navigate', { url: 'http://127.0.0.1:3000/' }], ['browser_snapshot', {}]]) {
          const result = await client.callTool(browserCall(select(suffix), args));
          emit({ gate: suffix, isError: Boolean(result.isError) });
          requireGate(!result.isError, 'PLAYWRIGHT_CALL_FAILED');
        }
      } finally {
        const closed = await client.callTool(browserCall(select('browser_close'), {}));
        emit({ gate: 'browser_close', isError: Boolean(closed.isError) });
        requireGate(!closed.isError, 'PLAYWRIGHT_CLOSE_FAILED');
      }
    }, { project, credentialPurpose: 'general', timeoutMs: 60000 });
  } else {
    const status = await api('/mcp-servers/status?project=ingenium');
    const discovery = status.body.data?.find(server => server.name === 'playwright')?.discovery_status;
    emit({ gate: 'playwright', verdict: 'COMPAT-LIMIT', discovery, count: 0 });
    requireGate(discovery === 'pending', 'PLAYWRIGHT_DISCOVERY_FAILED');
  }
  const removed = await api('/mcp-servers/playwright?project=ingenium', 'DELETE');
  emit({ gate: 'preset-delete', status: removed.status });
  requireGate(removed.status === 204, 'PRESET_DELETE_FAILED');
  preset = false;
  requireGate(!(await api('/mcp-servers?project=ingenium')).body.data.some(server => server.name === 'playwright'), 'PRESET_RESIDUAL');
  stage = 'VISUALS';
  const changed = new Map([['/chat', 'chat'], ['/opencode', 'opencode'], ['/mcp-servers', 'mcp-servers'], ['/context', 'context'], ['/?settings=cloudflare', 'cloudflare']]);
  const navigation = readFileSync('services/ingenium-dashboard/src/app/components/Navigation.tsx', 'utf8');
  const routes = [...new Set([...changed.keys(), ...[...navigation.matchAll(/href: "(\/[^"\s]*)"/g)].map(match => match[1]), '/account'])];
  let failures = [];
  page.on('pageerror', () => failures.push('pageerror'));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${new URL(response.url()).pathname}:${response.status()}`); });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      failures = [];
      const url = new URL(route, origin);
      url.searchParams.set('project', project);
      const response = await page.goto(url.href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const screenshot = changed.has(route) ? `${directory}/${changed.get(route)}-${viewport.width}x${viewport.height}.png` : undefined;
      if (screenshot) await page.screenshot({ path: screenshot, animations: 'disabled', mask: [page.locator('input[type="password"]')] });
      emit({ gate: 'sweep', route, viewport, status: response?.status(), overflow, failures, screenshot });
      requireGate(response?.status() === 200 && new URL(page.url()).pathname !== '/login' && !overflow && !failures.length, 'VISUAL_SWEEP_FAILED');
      await delay(10000);
    }
  }
} catch (error) {
  emit({ blocker: error.message?.match(/^[A-Z_]+$/)?.[0] ?? `${stage}_FAILED`, stage, kind: error.name });
  process.exitCode = 1;
} finally {
  try {
    if (memory) emit({ cleanup: 'memory', status: (await api(`/memory/${memory.id}?project=ingenium`, 'DELETE', { workspaceId, operationId: randomUUID(), expectedVersion: memory.version })).status });
    if (preset) emit({ cleanup: 'preset', status: (await api('/mcp-servers/playwright?project=ingenium', 'DELETE')).status });
  } finally { await browser?.close(); emit({ cleanup: 'browser-closed', directory }); }
}
