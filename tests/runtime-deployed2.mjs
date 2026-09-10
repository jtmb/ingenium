import { chromium } from 'playwright';
import { openSync, closeSync, constants, fstatSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withMcpClient, mcpToolData } from '../packages/ingenium-extension/dist/mcp-client.js';

const root = process.cwd();
const origin = 'http://localhost:3000';
const project = 'ingenium';
const workspaceId = 'shared-memory-ingenium';
const directory = `${root}/tests/artifacts/visual-qa/runtime-${Date.now()}-deployed2`;
const emit = (data) => console.log(JSON.stringify(data));
const browser = await chromium.launch({ executablePath: '/home/brajam/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
let csrf;
let memory;
let preset = false;
let stage = 'auth';
async function api(path, method = 'GET', data) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await context.request.fetch(`${origin}/api/v1${path}`, {
      method, data, maxRedirects: 0,
      headers: { origin, 'x-ingenium-ui': 'dashboard', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    });
    if (response.status() === 429 && method === 'GET') {
      await delay(Math.max(1000, Number(response.headers()['retry-after'] || 1) * 1000));
      continue;
    }
    return { status: response.status(), body: await response.json().catch(() => ({})) };
  }
  throw new Error('rate limit unresolved');
}
try {
  const fd = openSync(`${root}/.env`, constants.O_RDONLY | constants.O_NOFOLLOW);
  let credentials;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw new Error('protected env');
    credentials = parseEnv(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  csrf = (await api('/auth/csrf')).body.data.csrfToken;
  const login = await api('/auth/login', 'POST', { email: credentials.INGENIUM_DASHBOARD_EMAIL, password: credentials.INGENIUM_DASHBOARD_PASSWORD });
  credentials = undefined;
  emit({ login: login.status });
  if (login.status !== 200) throw new Error('login');
  csrf = login.body.data.csrfToken;
  emit({ session: (await api('/auth/session')).status });
  if (!process.argv.includes('--sweep-only')) {
  stage = 'memory';
  const marker = `deployed2${Date.now()}`;
  const saved = await api(`/memory?project=${project}`, 'POST', { workspaceId, operationId: randomUUID(), content: marker });
  memory = saved.body.data?.memory;
  emit({ memorySave: saved.status, created: Boolean(memory) });
  await withMcpClient(root, async (client) => {
    const tools = (await client.listTools()).tools.map(t => t.name).filter(n => n.startsWith('memory_'));
    emit({ memoryTools: tools, count: tools.length });
    for (const name of ['memory_list', 'memory_search']) {
      const result = await client.callTool({ name, arguments: { project, workspaceId, query: marker } });
      const data = mcpToolData(result);
      emit({ tool: name, isError: Boolean(result.isError), code: data.error?.code, presence: result.isError ? 'unavailable' : JSON.stringify(data).includes(marker) });
    }
  }, { project, credentialPurpose: 'general', timeoutMs: 60000 });
  stage = 'preset';
  const existing = await api(`/mcp-servers?project=${project}`);
  if (existing.status !== 200) throw new Error('preset preflight');
  if (existing.body.data.some(s => s.name === 'playwright')) {
    const removed = await api(`/mcp-servers/playwright?project=${project}`, 'DELETE');
    emit({ presetPriorRemoval: removed.status });
    if (removed.status !== 204) throw new Error('preset precondition');
  }
  const created = await api(`/mcp-servers/presets/playwright?project=${project}`, 'POST', {});
  preset = created.status === 201;
  emit({ presetCreate: created.status });
  if (!preset) throw new Error('preset creation');
  emit({ presetRefresh: (await api(`/mcp-servers/playwright/refresh?project=${project}`, 'POST', {})).status });
  for (let i = 0; i < 4; i++) {
    await delay(5500);
    const result = await api(`/mcp-servers/playwright/tools?project=${project}`);
    emit({ discoveryPoll: i, status: result.status, count: result.body.total, names: result.body.data?.map(t => t.name) });
    if (result.body.total > 0) break;
  }
  emit({ presetStatus: (await api(`/mcp-servers/status?project=${project}`)).body.data?.filter(s => s.name === 'playwright') });
  }
  stage = 'sweep';
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const changed = new Map([['/chat', 'chat'], ['/opencode', 'opencode'], ['/mcp-servers', 'mcp-servers'], ['/context', 'context'], ['/?settings=cloudflare', 'cloudflare']]);
  const navigation = readFileSync(`${root}/services/ingenium-dashboard/src/app/components/Navigation.tsx`, 'utf8');
  const routes = [...new Set([...changed.keys(), ...[...navigation.matchAll(/href: "(\/[^"\s]*)"/g)].map(m => m[1]), '/account'])];
  let errors = [], network = [], failures = [];
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.type()); });
  page.on('pageerror', error => errors.push(error.name));
  page.on('requestfailed', request => failures.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) network.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      stage = `sweep ${route} ${viewport.width}`;
      errors = []; network = []; failures = [];
      const target = new URL(route, origin);
      target.searchParams.set('project', project);
      target.searchParams.set('deployed2', String(Date.now()));
      let response = await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      if (response?.status() === 429) {
        await delay(2000);
        response = await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const recovered429 = [];
      for (const path of [...new Set(network.filter(n => n.status === 429).map(n => n.path))]) {
        await delay(1500);
        const retried = await context.request.get(`${origin}${path}?project=${project}`);
        recovered429.push({ path, status: retried.status() });
      }
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth, login: location.pathname === '/login',
        activeProject: localStorage.getItem('ingenium_active_project'),
        explicitMemory: document.body.innerText.includes('Saved memory'), cloudflare: document.body.innerText.includes('Cloudflare'),
        preset: document.body.innerText.includes('Playwright'),
      }));
      const screenshot = changed.has(route) ? `${directory}/${changed.get(route)}-${viewport.width}x${viewport.height}.png` : undefined;
      if (screenshot) await page.screenshot({ path: screenshot, animations: 'disabled', mask: [page.locator('input[type="password"]')] });
      emit({ route, viewport, status: response?.status(), cacheControl: response?.headers()['cache-control'], ...state, errors, network, failures, recovered429, screenshot });
      if (state.login) throw new Error('lost auth');
      if (state.activeProject !== project) throw new Error('wrong project');
      if (route === '/chat' && viewport.width === 1440) {
        const asset = await page.locator('script[src^="/_next/static/"]').first().getAttribute('src');
        if (asset) {
          const res = await context.request.get(`${origin}${asset}`);
          emit({ fingerprintedAsset: res.status(), cacheControl: res.headers()['cache-control'] });
        }
      }
      await delay(10000);
    }
  }
} catch (error) {
  emit({ failure: stage, kind: error.name, code: error.errorCode });
  process.exitCode = 1;
} finally {
  try {
    if (memory) emit({ memoryCleanup: (await api(`/memory/${memory.id}?project=${project}`, 'DELETE', { workspaceId, expectedVersion: memory.version, operationId: randomUUID() })).status });
    if (preset) emit({ presetCleanup: (await api(`/mcp-servers/playwright?project=${project}`, 'DELETE')).status });
  } finally { await browser.close(); emit({ browserClosed: true, directory }); }
}
