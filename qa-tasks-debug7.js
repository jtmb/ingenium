const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // On a fresh page, check for sortable elements BEFORE any interaction
  console.log('=== FRESH PAGE: SORTABLE ELEMENTS ===');
  const p1 = await context.newPage();
  await p1.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p1.waitForTimeout(2000);

  const initialSortables = await p1.evaluate(() => {
    const sels = document.querySelectorAll('[aria-roledescription="sortable"]');
    return Array.from(sels).map(el => ({
      text: el.textContent.trim().substring(0, 60),
      tag: el.tagName,
      hasEdit: el.innerHTML.includes('✏️'),
      role: el.getAttribute('role')
    }));
  });
  console.log(`  Initial sortable count: ${initialSortables.length}`);
  console.log(`  First sortable: ${JSON.stringify(initialSortables[0])}`);

  // Now click the edit button of the first task
  console.log('\n=== CLICKING EDIT BUTTON ===');
  // Re-get the sortable element
  const firstTask = p1.locator('[aria-roledescription="sortable"]').first();
  await firstTask.hover();
  await p1.waitForTimeout(500);

  const editBtn = p1.locator('button[title="Edit"]').first();
  const editBtnVisible = await editBtn.isVisible();
  console.log(`  Edit button visible after hover: ${editBtnVisible}`);

  if (editBtnVisible) {
    await editBtn.click();
    await p1.waitForTimeout(1500);

    // Check what happened
    const afterEdit = await p1.evaluate(() => {
      return {
        sortables: document.querySelectorAll('[aria-roledescription="sortable"]').length,
        inputs_count: document.querySelectorAll('input').length,
        select_count: document.querySelectorAll('select').length,
        // Look at the card area — find anything that changed
        bodyText: document.body.innerText.substring(0, 500),
        // Check if any card now has an input
        cardInputs: Array.from(document.querySelectorAll('[aria-roledescription="sortable"] input, [aria-roledescription="sortable"] textarea')).length,
        // Check for any element that appeared (maybe the edit form replaces the card)
        newVisibleElements: Array.from(document.querySelectorAll('input, textarea, select')).filter(el => el.offsetParent !== null).map(el => ({
          tag: el.tagName,
          placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
          value: el.value ? el.value.substring(0, 30) : ''
        }))
      };
    });
    console.log(`  After edit click: ${JSON.stringify(afterEdit, null, 2)}`);

    // Take screenshot
    await p1.screenshot({ path: '/tmp/qa-edit-click.png', fullPage: true });
    console.log('  Screenshot saved to /tmp/qa-edit-click.png');

    // Check the first few tasks' HTML to see if any changed
    const taskHTML = await p1.evaluate(() => {
      const sortables = document.querySelectorAll('[aria-roledescription="sortable"]');
      if (sortables.length > 0) {
        return Array.from(sortables).slice(0, 3).map(el => el.outerHTML.substring(0, 300));
      }
      // Maybe cards changed to a different structure
      // Check all role=button elements
      const buttons = document.querySelectorAll('[role="button"]');
      return Array.from(buttons).slice(0, 5).map(el => ({
        text: el.textContent.trim().substring(0, 60),
        outer: el.outerHTML.substring(0, 200)
      }));
    });
    console.log('\n  Task HTML after edit:');
    taskHTML.forEach((t, i) => console.log(`    [${i}] ${typeof t === 'string' ? t.substring(0, 200) : JSON.stringify(t)}`));
  }

  // Check the 404 URL
  console.log('\n=== 404 INVESTIGATION ===');
  const p2 = await context.newPage();
  const failedReqs = [];
  p2.on('requestfailed', req => failedReqs.push({ url: req.url(), failure: req.failure()?.errorText }));
  p2.on('response', res => {
    if (res.status() >= 400) {
      failedReqs.push({ url: res.url(), status: res.status() });
    }
  });

  await p2.goto('http://localhost:3000/tasks', { waitUntil: 'load', timeout: 20000 });
  await p2.waitForTimeout(3000);

  console.log(`  Failed/bad requests:`);
  failedReqs.forEach(r => console.log(`    ${r.status || 'ERR'} ${r.failure || ''} ${r.url}`));

  await browser.close();
})();
