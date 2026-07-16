/**
 * take-screenshots.js — Playwright screenshot capture for documentation.
 *
 * Captures key dashboard pages at desktop (1440×900) and mobile (390×844) viewports.
 *
 * Design decisions:
 * - Opens a fresh page per screenshot to avoid stale DOM/caches from prior navigations.
 * - Uses `domcontentloaded` + fixed delays instead of `networkidle` because the
 *   dashboard has background polling endpoints that never fully settle.
 * - Desktop viewport (1440×900) matches a standard 16:9 laptop display; mobile
 *   (390×844) matches iPhone 14 Pro dimensions for realistic responsive captures.
 */
const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS_DIR = '/tmp/opencode/ingenium-acceptance';

(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Mail page — default inbox view, full-length capture for scrolling content
    const page1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page1.goto('http://localhost:3000/mail', { waitUntil: 'domcontentloaded' });
    // WARNING: 3s delay gives the dashboard's polling-based summary endpoint
    // time to respond; adjust if the mail page switches to server-sent events
    await page1.waitForTimeout(3000);
    await page1.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mail-default.png'), fullPage: true });
    console.log('✓ mail-default.png');
    await page1.close();

    // 2. Compose desktop — viewport-only capture (fullPage would include blank
    // space below the compose dialog since it's an overlay, not scrolling content)
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page2.goto('http://localhost:3000/mail', { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(3000);
    const composeBtn = page2.locator('button').filter({ hasText: 'Compose' }).first();
    // NOTE: .catch(() => false) is needed because Playwright's isVisible throws
    // on timeout rather than returning a boolean; this avoids try/catch per locator
    if (await composeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await composeBtn.click();
      // 1.5s delay allows compose dialog slide-in animation to finish
      await page2.waitForTimeout(1500);
      await page2.screenshot({ path: path.join(SCREENSHOTS_DIR, 'compose-desktop.png'), fullPage: false });
      console.log('✓ compose-desktop.png');
    } else {
      console.log('⚠ compose button not found');
    }
    await page2.close();

    // 3. Compose mobile — iPhone 14 Pro viewport (390×844) to capture responsive layout.
    // No else-branch here (unlike desktop) because the mobile compose button may
    // be in a hamburger menu — absence is not an error worth flagging.
    const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page3.goto('http://localhost:3000/mail', { waitUntil: 'domcontentloaded' });
    await page3.waitForTimeout(3000);
    const composeBtn2 = page3.locator('button').filter({ hasText: 'Compose' }).first();
    if (await composeBtn2.isVisible({ timeout: 5000 }).catch(() => false)) {
      await composeBtn2.click();
      await page3.waitForTimeout(1500);
      await page3.screenshot({ path: path.join(SCREENSHOTS_DIR, 'compose-mobile.png'), fullPage: false });
      console.log('✓ compose-mobile.png');
    }
    await page3.close();

    // 4. OpenCode page — dual-mode MCP interface (WebSocket + ttyd iframes).
    // Longer delay (5s) because embedded iframes have their own load cycle
    // beyond the parent DOMContentReady event.
    const page4 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page4.goto('http://localhost:3000/opencode', { waitUntil: 'domcontentloaded' });
    await page4.waitForTimeout(5000);
    await page4.screenshot({ path: path.join(SCREENSHOTS_DIR, 'opencode.png'), fullPage: false });
    console.log('✓ opencode.png');
    await page4.close();

    console.log('DONE - all screenshots captured');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
