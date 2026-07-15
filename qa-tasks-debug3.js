const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();

  // Capture ALL network requests
  const requests = [];
  page.on('requestfailed', req => requests.push({ url: req.url(), failure: req.failure()?.errorText, status: 'failed' }));
  page.on('response', res => {
    if (res.status() >= 400) requests.push({ url: res.url(), status: res.status(), failure: res.statusText() });
  });

  const msgs = [];
  page.on('console', msg => msgs.push(msg));

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  console.log('=== FAILED/NON-200 REQUESTS ===');
  requests.forEach(r => console.log(`  ${r.status} ${r.url} ${r.failure || ''}`));

  console.log('\n=== ALL CONSOLE MESSAGES ===');
  msgs.forEach(m => console.log(`  [${m.type()}] ${m.text()}`));

  // Find ALL column headers: look for text nodes that match column names
  const columns = await page.evaluate(() => {
    // Walk text nodes looking for column headers
    const xpathResult = document.evaluate(
      '//*[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]',
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    );
    const results = [];
    for (let i = 0; i < xpathResult.snapshotLength; i++) {
      const node = xpathResult.snapshotItem(i);
      if (node) {
        // Walk up to find column container
        let col = node;
        for (let j = 0; j < 6 && col; j++) {
          if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
          col = col.parentElement;
        }
        const rect = col ? col.getBoundingClientRect() : null;
        results.push({
          text: node.textContent,
          tagName: node.tagName,
          className: node.className?.substring(0, 60),
          colClass: col ? col.className?.substring(0, 80) : 'none',
          colRect: rect ? `${rect.width}x${rect.height} at ${rect.x},${rect.y}` : 'none',
          colChildren: col ? col.children.length : 0
        });
      }
    }
    return results;
  });
  console.log('\n=== COLUMNS (via XPath) ===');
  columns.forEach((c, i) => console.log(`  Col ${i}: ${c.text} (${c.tagName}) class=${c.className} col=${c.colClass} rect=${c.colRect} children=${c.colChildren}`));

  // Count task cards using the actual selector
  const taskCount = await page.evaluate(() => document.querySelectorAll('[aria-roledescription="sortable"]').length);
  console.log(`\n=== SORTABLE TASKS: ${taskCount}`);

  // Get text content of a sortable task
  if (taskCount > 0) {
    const taskTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[aria-roledescription="sortable"]')).map(el => el.textContent.trim().substring(0, 80));
    });
    console.log('Task texts:', JSON.stringify(taskTexts));
  }

  await browser.close();
})();
