import { chromium, request } from 'playwright';
import { openSync, closeSync, constants, fstatSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withMcpClient, mcpToolData } from '../packages/ingenium-extension/dist/mcp-client.js';

const origin = 'http://localhost:3000';
const context = await request.newContext({ baseURL: origin });
let csrf;
let browser;
let memory;
let presetCreated = false;
const project = 'ingenium';
const workspaceId = 'shared-memory-ingenium';
const emit = (state) => console.log(JSON.stringify(state));
async function api(path, method = 'GET', data) {
  const response = await context.fetch(`/api/v1${path}`, {
    method, data, timeout: 30000,
    headers: { origin, 'x-ingenium-ui': 'dashboard', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
  });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}
try {
  const fd = openSync('.env', constants.O_RDONLY | constants.O_NOFOLLOW);
  let credentials;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw new Error('PROTECTED_ENV_REQUIRED');
    credentials = parseEnv(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  csrf = (await api('/auth/csrf')).body.data.csrfToken;
  const login = await api('/auth/login', 'POST', { email: credentials.INGENIUM_DASHBOARD_EMAIL, password: credentials.INGENIUM_DASHBOARD_PASSWORD });
  credentials = undefined;
  console.log(JSON.stringify({ surface: 'login', status: login.status }));
  if (login.status !== 200) throw new Error('LOGIN_FAILED');
  csrf = login.body.data.csrfToken;
  for (const path of ['/runtimes/browser/status?project=ingenium', '/runtimes/browser/workspaces', '/opencode/mcp', '/mcp-servers/status?project=ingenium']) {
    const result = await api(path);
    const data = path === '/opencode/mcp'
      ? Object.fromEntries(Object.entries(result.body.data ?? {}).map(([name, value]) => [name, { status: value.status }]))
      : result.body.data;
    console.log(JSON.stringify({ surface: path, status: result.status, data }));
  }
  if (process.argv.includes('--proof')) {
    browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ storageState: await context.storageState() });
    const page = await browserContext.newPage();
    const chat = await page.goto(`${origin}/chat?project=${project}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Select a confirmed project workspace to use saved memory.', { exact: false })
      .first().waitFor({ timeout: 15000 }).catch(() => {});
    emit({ surface: 'C-chat', status: chat?.status(), unboundMemory:
      (await page.locator('body').innerText()).includes('Select a confirmed project workspace to use saved memory.') });
    const marker = `synthetic-memory-${randomUUID()}`;
    const saved = await api(`/memory?project=${project}`, 'POST', { workspaceId, operationId: randomUUID(), content: marker });
    memory = saved.body.data?.memory;
    emit({ surface: 'memory-backend', action: 'save', status: saved.status, created: Boolean(memory) });
    if (memory) {
      await Promise.all(['A', 'B'].map(async (surface) => {
        try {
          await withMcpClient(process.cwd(), async (client) => {
            const names = (await client.listTools()).tools.map((tool) => tool.name);
            const result = await client.callTool({ name: 'memory_search', arguments: { project, workspaceId, query: marker } });
            const data = mcpToolData(result);
            emit({ surface, evidenceClass: 'independent-MCP-client-not-model-session',
              memoryTools: names.filter((name) => name.startsWith('memory_')).length,
              isError: Boolean(result.isError), code: data.error?.code,
              found: !result.isError && JSON.stringify(data).includes(marker) });
          }, { project, credentialPurpose: 'general', timeoutMs: 60000 });
        } catch (error) { emit({ surface, state: 'blocked', failure: error.name, category: error.failure, stage: error.stage, boundary: error.boundary }); }
      }));
      const updated = await api(`/memory/${memory.id}?project=${project}`, 'PATCH', {
        workspaceId, operationId: randomUUID(), expectedVersion: memory.version, content: `${marker}-updated`,
      });
      if (updated.body.data?.memory) memory = updated.body.data.memory;
      emit({ surface: 'memory-backend', action: 'update', status: updated.status });
    }
    const existing = await api(`/mcp-servers?project=${project}`);
    if (existing.status !== 200 || existing.body.data.some((server) => server.name === 'playwright')) {
      emit({ surface: 'Playwright', state: 'blocked-existing-or-unavailable-preset-not-modified' });
    } else {
      const created = await api(`/mcp-servers/presets/playwright?project=${project}`, 'POST', {});
      presetCreated = created.status === 201;
      emit({ surface: 'Playwright', action: 'preset-create', status: created.status });
      if (presetCreated) {
        emit({ surface: 'Playwright', action: 'refresh', status: (await api(`/mcp-servers/playwright/refresh?project=${project}`, 'POST', {})).status });
        for (let poll = 0; poll < 3; poll++) {
          await delay(5500);
          const tools = await api(`/mcp-servers/playwright/tools?project=${project}`);
          emit({ surface: 'Playwright', poll, status: tools.status, toolCount: tools.body.total });
          if (tools.body.total > 0) break;
        }
        const discovery = await api(`/mcp-servers/status?project=${project}`);
        emit({ surface: 'Playwright', discovery: discovery.body.data?.find((server) => server.name === 'playwright')?.discovery_status });
        const runtime = await api('/opencode/mcp');
        emit({ surface: 'C-runtime', mcp: runtime.body.data?.ingenium?.status,
          modelMemoryProof: 'not-run-runtime-unconfirmed', playwrightCalls: 'not-run-runtime-client-unavailable' });
      }
    }
  }
} catch (error) {
  console.log(JSON.stringify({ failure: error.name }));
  process.exitCode = 1;
} finally {
  try {
    if (memory) emit({ surface: 'memory-backend', action: 'forget', status: (await api(`/memory/${memory.id}?project=${project}`, 'DELETE', {
      workspaceId, expectedVersion: memory.version, operationId: randomUUID(),
    })).status });
    if (presetCreated) emit({ surface: 'Playwright', action: 'preset-delete', status: (await api(`/mcp-servers/playwright?project=${project}`, 'DELETE')).status });
  } finally {
    await browser?.close();
    await context.dispose();
    emit({ cleanup: 'verification-browser-and-http-context-closed' });
  }
}
