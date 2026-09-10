#!/usr/bin/env node
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

delete process.env.DEBUG;
delete process.env.PWDEBUG;
const origin = 'http://localhost:3000';
let browser;
let stage = 'protected env read';
try {
  const fd = openSync('/home/brajam/repos/ingenium/.env', constants.O_RDONLY | constants.O_NOFOLLOW);
  let credentials;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw new Error();
    credentials = parseEnv(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  const email = credentials.INGENIUM_DASHBOARD_EMAIL;
  const password = credentials.INGENIUM_DASHBOARD_PASSWORD;
  if (email !== 'bootstrap-admin@localhost' || !/^[A-Za-z0-9_-]{32}$/.test(password)) throw new Error();
  credentials = undefined;
  stage = 'bootstrap status';
  const status = await fetch(`${origin}/api/v1/bootstrap/status`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  stage = `bootstrap status HTTP ${status.status}`;
  if (status.status !== 200 || (await status.json()).data?.state !== 'claimed') throw new Error();
  console.log('bootstrap status 200 (claimed)');
  stage = 'browser launch';
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/home/brajam/.cache/ms-playwright/chromium-1232/chrome-linux64/chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  stage = 'login page/CSRF';
  const response = await page.goto(`${origin}/login`, { waitUntil: 'networkidle' });
  if (response?.status() !== 200) { stage = `login page HTTP ${response?.status() ?? 'unavailable'}`; throw new Error(); }
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  stage = 'login submission';
  const loginResponse = page.waitForResponse((r) => r.url() === `${origin}/api/v1/auth/login` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await loginResponse;
  stage = `login HTTP ${login.status()}`;
  if (login.status() !== 200) {
    const body = await login.json().catch(() => null);
    const code = body?.error?.code;
    const reasons = ['AUTHENTICATION_FAILED', 'FORBIDDEN', 'UNAUTHORIZED', 'CSRF_INVALID', 'CSRF_REQUIRED', 'RATE_LIMITED', 'VALIDATION_ERROR'];
    stage += login.status() === 202 ? ' MFA required' : reasons.includes(code) ? ` ${code}` : ' rejected (response body withheld)';
    throw new Error();
  }
  await page.waitForURL((url) => url.pathname !== '/login');
  const session = await context.request.get(`${origin}/api/v1/auth/session`, { maxRedirects: 0 });
  stage = `account session HTTP ${session.status()}`;
  if (session.status() !== 200 || (await session.json()).data?.user?.email_normalized !== email) throw new Error();
  console.log('login 200; account session 200 (email matched)');
  for (const route of ['/chat', '/opencode']) {
    const result = await context.request.get(`${origin}${route}`, { maxRedirects: 0 });
    stage = `${route} HTTP ${result.status()}`;
    if (result.status() !== 200) throw new Error();
    console.log(`${route} 200 (no redirect)`);
  }
  const directory = `tests/artifacts/visual-qa/runtime-${Date.now()}`;
  mkdirSync(directory, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [name, route] of [['chat', '/chat'], ['opencode', '/opencode'], ['mcp-servers', '/mcp-servers'], ['context', '/context'], ['cloudflare', '/?settings=cloudflare']]) {
      stage = `capture ${name} ${viewport.width}x${viewport.height}`;
      const result = await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
      if (result?.status() !== 200 || new URL(page.url()).pathname === '/login') throw new Error();
      await page.locator('body').waitFor({ state: 'visible' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const path = `${directory}/${name}-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path, animations: 'disabled', mask: [page.locator('input[type="password"]')] });
      console.log(path);
    }
  }
} catch {
  console.error(`Verification failed: ${stage}; memory/preset items BLOCKED`);
  process.exitCode = 1;
} finally {
  if (browser) {
    try { await browser.close(); console.log('browser closed'); }
    catch { console.error('browser close failed'); process.exitCode = 1; }
  }
}
