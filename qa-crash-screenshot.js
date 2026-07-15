const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  // Hover over first task and click Edit
  const card = page.locator('[aria-roledescription="sortable"]').first();
  await card.hover();
  await page.waitForTimeout(500);
  
  const editBtn = page.locator('button[title="Edit"]').first();
  await editBtn.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/qa-p3d-crash-state.png', fullPage: true });
  console.log('Crash screenshot saved');

  // Also get the error boundary text
  const body = await page.evaluate(() => document.body.innerText);
  console.log('Crash state body:', body.substring(0, 200));

  await browser.close();
})();
