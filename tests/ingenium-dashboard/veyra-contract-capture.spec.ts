import { test, expect } from './fixture';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { visualQaRunDirectory } from './visual-qa-artifacts';
import { getDefaultSuiteRuntime } from './default-suite-runtime';

const contract = JSON.parse(readFileSync(join(__dirname, '../../docs/design/veyra-screen-contract.json'), 'utf8'));
const additional: Record<string, string> = {
  'chat-conversation-v3': '/chat',
  'navigation-all-features-v4': '/chat',
  'context-saved-memory': '/context',
  'settings-security': '/?settings=security',
  'settings-sessions': '/?settings=sessions',
  'settings-api-tokens': '/?settings=api-tokens',
  'settings-providers-schedule-v2': '/?settings=providers',
  'settings-cloudflare': '/?settings=cloudflare',
  'settings-mail': '/?settings=mail',
};
const publicRoutes = /^\/(?:auth\/oidc\/callback|bootstrap|forgot-password|invitation|login|mfa|reset-password|verify-email)(?:$|\?)/;

test('capture all contracted views with explicit fixture and unfinished-state labels', async ({ page, browser }) => {
  test.setTimeout(300_000);
  const runtime = getDefaultSuiteRuntime();
  const artifacts = visualQaRunDirectory(runtime.context.runId);
  mkdirSync(artifacts, { recursive: true });
  const publicContext = await browser.newContext({ baseURL: runtime.dashboardUrl });
  const publicPage = await publicContext.newPage();
  const results: Record<string, unknown>[] = [];
  try {
    for (const view of contract.views) {
      const route = (additional[view.id] ?? view.route).replace('[id]', '1');
      const target = publicRoutes.test(route) ? publicPage : page;
      const errors: string[] = [];
      const onError = (error: Error) => errors.push(error.message);
      target.on('pageerror', onError);
      await target.setViewportSize({ width: view.width, height: view.height });
      const response = await target.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(target.locator('body')).toBeVisible();
      await target.evaluate(() => document.fonts.ready);
      // Allow the real fixture API to settle. Failed/loading states remain in
      // the evidence; capture never replaces them with successful mock cards.
      await target.waitForTimeout(750);
      let state = 'Existing implementation with controlled fixture data; visual review pending';
      if (view.id === 'chat-conversation-v3') {
        const composer = target.getByTestId('chat-composer');
        await expect(composer).toBeEnabled({ timeout: 20_000 });
        await composer.fill('Hello from E2E test');
        await composer.press('Enter');
        await expect(target.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30_000 });
        state = 'Actual fixture send/stream; live provider acceptance remains open';
      }
      if (view.id === 'navigation-all-features-v4') {
        await target.getByRole('button', { name: 'Expand navigation', exact: true }).click();
      }
      if (view.id === 'context-saved-memory') state = 'Context route exists; selected saved-memory editing state needs controlled conversation data';
      if (view.id === 'opencode-upstream-actual' || view.id === 'vscode') state = 'Host route only; actual upstream runtime requires cluster capture';
      if (view.route.includes('[id]')) state = 'Detail route with fixture identifier; populated detail workflow remains a separate gate';
      if (publicRoutes.test(route)) state = 'Unauthenticated fixture state; complete identity workflows remain a separate gate';
      const controls = await target.locator('a,button,input,select,textarea,[role="tab"]').evaluateAll(elements => elements.map(element => ({
        tag: element.tagName.toLowerCase(), label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 120),
        href: element.getAttribute('href'), disabled: element.hasAttribute('disabled'),
      })));
      const alerts = await target.locator('[role="alert"]').allTextContents();
      const image = join(artifacts, `${view.id}-fixture.png`);
      await target.screenshot({ path: image, fullPage: false, animations: 'disabled' });
      results.push({ id: view.id, baselineSha256: view.sha256, route, finalUrl: target.url(), status: response?.status(), state, alerts, errors, controls,
        screenshot: image, screenshotSha256: createHash('sha256').update(readFileSync(image)).digest('hex') });
      target.off('pageerror', onError);
    }
  } finally {
    await publicContext.close();
    writeFileSync(join(artifacts, 'veyra-47-view-fixture-manifest.json'), `${JSON.stringify({
      fixture: true, runtimeAcceptance: false, visualApproval: false, runId: runtime.context.runId,
      expectedViews: contract.viewCount, capturedViews: results.length, views: results,
    }, null, 2)}\n`);
  }
  expect(results).toHaveLength(47);
  expect(results.filter(result => (result.errors as string[]).length)).toEqual([]);
});
