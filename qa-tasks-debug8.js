const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

async function testEditClick(attempt) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE_ERROR: ' + err.message));

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  const sortableCount = await page.evaluate(() => document.querySelectorAll('[aria-roledescription="sortable"]').length);
  console.log(`  [Attempt ${attempt}] Sortable count: ${sortableCount}`);

  if (sortableCount > 0) {
    const firstTask = page.locator('[aria-roledescription="sortable"]').first();
    await firstTask.hover();
    await page.waitForTimeout(500);

    // Get the 2nd task instead of 1st to see if it matters which one
    const taskIdx = attempt === 1 ? 0 : 1;
    const targetTask = page.locator('[aria-roledescription="sortable"]').nth(taskIdx);
    await targetTask.hover();
    await page.waitForTimeout(300);

    const editBtn = page.locator('button[title="Edit"]').first();
    if (await editBtn.isVisible()) {
      console.log(`  Clicking Edit button (task ${taskIdx})`);
      await editBtn.click();
      await page.waitForTimeout(2000);

      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.log(`  Page body: "${bodyText}"`);
      
      if (bodyText.includes("couldn't load") || bodyText.includes('error')) {
        console.log(`  ❌ PAGE CRASH DETECTED on attempt ${attempt}`);
      } else {
        console.log(`  ✅ Page still functional on attempt ${attempt}`);
      }
    } else {
      console.log(`  Edit button not visible`);
    }
  }

  await page.screenshot({ path: `/tmp/qa-edit-attempt-${attempt}.png`, fullPage: true });
  console.log(`  Errors: ${errors.join('; ')}`);

  await browser.close();
}

(async () => {
  console.log('=== TESTING EDIT BUTTON CRASH (3 attempts) ===');
  for (let i = 1; i <= 3; i++) {
    await testEditClick(i);
    console.log('');
  }
})();
