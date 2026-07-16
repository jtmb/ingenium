const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS_DIR = '/home/brajam/repos/gh-llm-bootstrap/next-steps-plan/screenshots';

(async () => {
  const browser = await chromium.launch({ headless: true });
  
  try {
    // 1. Mail page - default view
    const page1 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page1.goto('http://localhost:3000/mail', { waitUntil: 'domcontentloaded' });
    await page1.waitForTimeout(3000);
    await page1.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mail-default.png'), fullPage: true });
    console.log('✓ mail-default.png');
    await page1.close();

    // 2. Compose desktop
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page2.goto('http://localhost:3000/mail', { waitUntil: 'domcontentloaded' });
    await page2.waitForTimeout(3000);
    const composeBtn = page2.locator('button').filter({ hasText: 'Compose' }).first();
    if (await composeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await composeBtn.click();
      await page2.waitForTimeout(1500);
      await page2.screenshot({ path: path.join(SCREENSHOTS_DIR, 'compose-desktop.png'), fullPage: false });
      console.log('✓ compose-desktop.png');
    } else {
      console.log('⚠ compose button not found');
    }
    await page2.close();

    // 3. Compose mobile (390x844)
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

    // 4. OpenCode page
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
