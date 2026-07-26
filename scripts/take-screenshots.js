/**
 * take-screenshots.js — Playwright screenshot capture for documentation.
 *
 * Captures key dashboard pages at desktop (1440×900) and mobile (390×844) viewports.
 *
 * Design decisions:
 * - Opens a fresh page per screenshot to avoid stale DOM/caches from prior navigations.
 * - Uses `domcontentloaded` plus explicit dashboard state conditions instead of
 *   `networkidle` because the dashboard has background polling endpoints that
 *   never fully settle.
 * - Desktop viewport (1440×900) matches a standard 16:9 laptop display; mobile
 *   (390×844) matches iPhone 14 Pro dimensions for realistic responsive captures.
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const MANUAL_ARTIFACT_ROOT = path.join(REPO_ROOT, 'tests', 'artifacts', 'manual');
const RUN_ID_ENV = 'INGENIUM_MANUAL_SCREENSHOT_RUN_ID';
const SCREENSHOT_TARGET_ENV = 'INGENIUM_SCREENSHOT_TARGET';
const SCREENSHOT_BASE_URL_ENV = 'INGENIUM_SCREENSHOT_BASE_URL';
const DASHBOARD_URL_ENV = 'INGENIUM_E2E_DASHBOARD_URL';
const SCREENSHOT_WAIT_TIMEOUT_ENV = 'INGENIUM_SCREENSHOT_WAIT_TIMEOUT_MS';
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

function pathIsInside(parent, child) {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function assertNoSymlinkAncestors(candidate, containmentRoot) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(containmentRoot);
  if (!pathIsInside(resolvedRoot, resolvedCandidate)) {
    throw new Error(`Manual screenshot path escaped its canonical root: ${candidate}`);
  }

  let cursor = resolvedCandidate;
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Manual screenshot path has a symlinked ancestor: ${candidate}`);
    }
    if (cursor === resolvedRoot) return;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Manual screenshot path has no canonical repository ancestor: ${candidate}`);
}

function safeRunId(value) {
  if (value === '.' || value === '..' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${RUN_ID_ENV} must be a single lexical path component`);
  }
  return value;
}

function createRunId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[.:]/g, '-');
  return `manual-${timestamp}-${crypto.randomUUID()}`;
}

function manualScreenshotDirectory(runId = process.env[RUN_ID_ENV]) {
  const selectedRunId = safeRunId((runId ?? '').trim() || createRunId());
  const manualRoot = path.resolve(MANUAL_ARTIFACT_ROOT);
  const runDirectory = path.join(manualRoot, selectedRunId);

  assertNoSymlinkAncestors(manualRoot, REPO_ROOT);
  fs.mkdirSync(manualRoot, { recursive: true, mode: 0o700 });
  assertNoSymlinkAncestors(manualRoot, REPO_ROOT);
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  assertNoSymlinkAncestors(runDirectory, manualRoot);
  if (fs.realpathSync(runDirectory) !== runDirectory) {
    throw new Error(`Manual screenshot run directory is not canonical: ${runDirectory}`);
  }

  return runDirectory;
}

function firstConfiguredValue(environment, names) {
  for (const name of names) {
    const value = environment[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function parseWaitTimeout(value) {
  if (value === undefined || value.trim() === '') return DEFAULT_WAIT_TIMEOUT_MS;

  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`${SCREENSHOT_WAIT_TIMEOUT_ENV} must be a positive integer in milliseconds`);
  }
  return timeout;
}

/**
 * Resolve the target and bounded state-wait timeout from the environment.
 *
 * There is deliberately no implicit local-server fallback here. A manual
 * capture must identify the dashboard instance it is intended to inspect,
 * which prevents a successful run from silently targeting the wrong server.
 */
function resolveScreenshotConfig(environment = process.env) {
  const rawTarget = firstConfiguredValue(environment, [
    SCREENSHOT_TARGET_ENV,
    SCREENSHOT_BASE_URL_ENV,
    DASHBOARD_URL_ENV,
  ]);
  if (!rawTarget) {
    throw new Error(
      `Set ${SCREENSHOT_TARGET_ENV} (or ${SCREENSHOT_BASE_URL_ENV}) to an absolute dashboard URL before capturing screenshots`,
    );
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error(`${SCREENSHOT_TARGET_ENV} must be a valid absolute URL`);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`${SCREENSHOT_TARGET_ENV} must use http or https`);
  }
  if (target.username || target.password) {
    throw new Error(`${SCREENSHOT_TARGET_ENV} must not contain credentials`);
  }

  target.hash = '';
  const baseUrl = target.toString().replace(/\/$/, '');
  return {
    baseUrl,
    waitTimeoutMs: parseWaitTimeout(
      firstConfiguredValue(environment, [SCREENSHOT_WAIT_TIMEOUT_ENV]),
    ),
  };
}

/** Build a route URL while preserving a configured target path prefix. */
function buildScreenshotUrl(baseUrl, route) {
  if (typeof route !== 'string' || !route.startsWith('/')) {
    throw new Error(`Screenshot route must be an absolute path: ${route}`);
  }

  const target = new URL(baseUrl);
  target.search = '';
  target.hash = '';
  if (!target.pathname.endsWith('/')) target.pathname += '/';
  return new URL(route.slice(1), target).toString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error) {
  return error instanceof Error && (
    error.name === 'TimeoutError' || /timeout/i.test(error.message)
  );
}

async function gotoAndWait(page, url, waitForReady, timeoutMs) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (response && typeof response.status === 'function' && response.status() >= 400) {
    throw new Error(`Dashboard target returned HTTP ${response.status()} for ${url}`);
  }
  try {
    await waitForReady(page, timeoutMs);
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(
        `Dashboard state wait timed out after ${timeoutMs}ms for ${url}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function waitForMailReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    const heading = Array.from(document.querySelectorAll('h1')).some(
      (element) => element.textContent?.trim() === 'Mail',
    );
    const bodyText = document.body?.innerText ?? '';
    const hasCompose = Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Compose',
    );
    const hasEmptyState = bodyText.includes('No email accounts configured');
    return heading && (hasCompose || hasEmptyState);
  }, undefined, { timeout: timeoutMs });
}

async function waitForComposeDialog(page, timeoutMs) {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Compose' }).first();
  await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
}

async function findComposeButton(page, timeoutMs) {
  const composeButton = page.locator('button').filter({ hasText: 'Compose' }).first();
  try {
    await composeButton.waitFor({ state: 'visible', timeout: timeoutMs });
    return composeButton;
  } catch (error) {
    // A dashboard with no configured account intentionally has no Compose
    // button. Other failures must still abort the capture.
    if (isTimeoutError(error)) return null;
    throw error;
  }
}

async function waitForOpenCodeReady(page, timeoutMs) {
  await page.waitForFunction(() => (
    document.querySelector('iframe[title="OpenCode Web"]') !== null
    || document.querySelector('[role="alert"]') !== null
  ), undefined, { timeout: timeoutMs });

  const iframeCount = await page.locator('iframe[title="OpenCode Web"]').count();
  if (iframeCount === 0) {
    const alertText = await page.locator('[role="alert"]').first().textContent().catch(() => 'unknown error');
    throw new Error(`OpenCode did not reach a capturable state: ${alertText || 'unknown error'}`);
  }
}

/**
 * Capture all manual screenshots. The browser launcher is injectable so the
 * failure and cleanup contract can be tested without depending on a live UI.
 */
async function captureScreenshots({
  config = resolveScreenshotConfig(),
  screenshotsDir = manualScreenshotDirectory(),
  launchBrowser = () => chromium.launch({ headless: true }),
} = {}) {
  const mailUrl = buildScreenshotUrl(config.baseUrl, '/mail');
  const openCodeUrl = buildScreenshotUrl(config.baseUrl, '/opencode');
  let browser;
  let captureError;

  try {
    browser = await launchBrowser();

    // 1. Mail page — default inbox view, full-length capture for scrolling content
    const page1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await gotoAndWait(page1, mailUrl, waitForMailReady, config.waitTimeoutMs);
    await page1.screenshot({ path: path.join(screenshotsDir, 'mail-default.png'), fullPage: true });
    console.log('✓ mail-default.png');
    await page1.close();

    // 2. Compose desktop — viewport-only capture (fullPage would include blank
    // space below the compose dialog since it's an overlay, not scrolling content)
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await gotoAndWait(page2, mailUrl, waitForMailReady, config.waitTimeoutMs);
    const composeBtn = await findComposeButton(page2, config.waitTimeoutMs);
    if (composeBtn) {
      await composeBtn.click();
      await waitForComposeDialog(page2, config.waitTimeoutMs);
      await page2.screenshot({ path: path.join(screenshotsDir, 'compose-desktop.png'), fullPage: false });
      console.log('✓ compose-desktop.png');
    } else {
      console.log('⚠ compose button not found');
    }
    await page2.close();

    // 3. Compose mobile — iPhone 14 Pro viewport (390×844) to capture responsive layout.
    // No else-branch here (unlike desktop) because the mobile compose button may
    // be in a hamburger menu — absence is not an error worth flagging.
    const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await gotoAndWait(page3, mailUrl, waitForMailReady, config.waitTimeoutMs);
    const composeBtn2 = await findComposeButton(page3, config.waitTimeoutMs);
    if (composeBtn2) {
      await composeBtn2.click();
      await waitForComposeDialog(page3, config.waitTimeoutMs);
      await page3.screenshot({ path: path.join(screenshotsDir, 'compose-mobile.png'), fullPage: false });
      console.log('✓ compose-mobile.png');
    }
    await page3.close();

    // 4. OpenCode page — dual-mode MCP interface (WebSocket + ttyd iframes).
    const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await gotoAndWait(page4, openCodeUrl, waitForOpenCodeReady, config.waitTimeoutMs);
    await page4.screenshot({ path: path.join(screenshotsDir, 'opencode.png'), fullPage: false });
    console.log('✓ opencode.png');
    await page4.close();

    console.log('DONE - all screenshots captured');
  } catch (error) {
    captureError = error;
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        if (!captureError) throw closeError;
        console.error(`Browser close failed after capture error: ${errorMessage(closeError)}`);
      }
    }
  }
}

async function main(options = {}) {
  const config = options.config ?? resolveScreenshotConfig();
  const screenshotsDir = options.screenshotsDir ?? manualScreenshotDirectory();
  console.log(`Saving screenshots to ${screenshotsDir}`);
  return captureScreenshots({ ...options, config, screenshotsDir });
}

module.exports = {
  buildScreenshotUrl,
  captureScreenshots,
  createRunId,
  getScreenshotConfig: resolveScreenshotConfig,
  manualScreenshotDirectory,
  main,
  resolveScreenshotConfig,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', errorMessage(error));
    process.exitCode = 1;
  });
}
