const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();

  // Aggressively capture ALL responses
  const responses = [];
  page.on('response', res => {
    responses.push({ url: res.url(), status: res.status(), type: res.request().resourceType() });
  });
  page.on('requestfailed', req => {
    responses.push({ url: req.url(), status: 'FAILED', error: req.failure()?.errorText });
  });

  // Console messages
  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Filter for non-200 responses
  const badResponses = responses.filter(r => r.status !== 200);
  console.log('=== NON-200 RESPONSES ===');
  badResponses.forEach(r => console.log(`  ${JSON.stringify(r)}`));

  // Console errors
  console.log('\n=== CONSOLE ERRORS ===');
  consoleMsgs.filter(m => m.type === 'error').forEach(m => console.log(`  ${m.text}`));

  // Now check the Edit button crash details with stack trace
  console.log('\n=== EDIT BUTTON CRASH DETAIL ===');
  const p2 = await browser.newPage();
  const pageErrors = [];
  p2.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack?.substring(0, 500) });
  });
  p2.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push({ message: msg.text(), stack: 'console.error' });
  });

  await p2.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p2.waitForTimeout(1500);

  const card = p2.locator('[aria-roledescription="sortable"]').first();
  await card.hover();
  await p2.waitForTimeout(500);
  
  const editBtn = p2.locator('button[title="Edit"]').first();
  await editBtn.click();
  await p2.waitForTimeout(2000);

  console.log(`  Page errors captured: ${pageErrors.length}`);
  pageErrors.forEach(e => {
    console.log(`  Message: ${e.message}`);
    console.log(`  Stack: ${e.stack}`);
  });

  // Check if there's a reload button visible and try it
  const body = await p2.evaluate(() => document.body.innerText);
  console.log(`\n  Page body after crash: "${body.substring(0, 200)}"`);
  
  const reloadBtn = p2.locator('button:has-text("Reload")');
  if (await reloadBtn.count() > 0) {
    console.log('  Reload button found — attempting reload...');
    await reloadBtn.click();
    await p2.waitForTimeout(3000);
    const body2 = await p2.evaluate(() => document.body.innerText);
    console.log(`  After reload: ${body2.includes('couldn') ? 'STILL CRASHED' : 'RECOVERED'}`);
  }

  await browser.close();
})();
