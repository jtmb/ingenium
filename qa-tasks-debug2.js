const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();
  
  const msgs = [];
  page.on('console', msg => msgs.push(msg));
  
  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Find the actual task card element structure
  const taskCards = await page.evaluate(() => {
    const results = [];
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const html = div.innerHTML;
      if ((html.includes('✏️') || html.includes('🗑️')) && div.children.length <= 5) {
        const rect = div.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 20 && rect.width < 800) {
          results.push({
            outerHTML: div.outerHTML.substring(0, 300),
            className: div.className.substring(0, 120),
            children: div.children.length,
            rect: `${rect.width}x${rect.height}`,
            attrDraggable: div.getAttribute('draggable'),
            attrRole: div.getAttribute('role'),
            attrTabIndex: div.getAttribute('tabindex'),
            onclick: div.getAttribute('onclick') ? 'yes' : 'no',
            style: div.getAttribute('style')?.substring(0, 80) || 'none'
          });
        }
      }
    }
    return results.slice(0, 5);
  });
  console.log('=== TASK CARDS (first 5) ===');
  taskCards.forEach((c, i) => {
    console.log(`\n--- Card ${i} ---`);
    console.log(`  outerHTML: ${c.outerHTML}`);
    console.log(`  class: ${c.className}`);
    console.log(`  children: ${c.children}`);
    console.log(`  rect: ${c.rect}`);
    console.log(`  draggable: ${c.attrDraggable}`);
    console.log(`  role: ${c.attrRole}`);
    console.log(`  tabindex: ${c.attrTabIndex}`);
    console.log(`  onclick: ${c.onclick}`);
    console.log(`  style: ${c.style}`);
  });

  // Column detection
  const colHeaders = await page.evaluate(() => {
    const results = [];
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const html = div.innerHTML;
      const text = div.textContent.trim();
      if (['Todo','In Progress','Review','Done'].includes(text) && div.children.length <= 1) {
        const parent = div.parentElement;
        const grandparent = parent ? parent.parentElement : null;
        results.push({
          text,
          divClass: div.className.substring(0, 60),
          parentClass: parent ? parent.className.substring(0, 60) : 'none',
          grandparentClass: grandparent ? grandparent.className.substring(0, 80) : 'none',
          parentChildren: parent ? parent.children.length : 0
        });
      }
    }
    return results;
  });
  console.log('\n=== COLUMN HEADERS ===');
  colHeaders.forEach(c => console.log(JSON.stringify(c)));

  // Check the 404
  const errMsgs = msgs.filter(m => m.type() === 'error');
  console.log('\n=== CONSOLE ERRORS ===');
  errMsgs.forEach(m => console.log(`  ${m.text()}`));

  await browser.close();
})();
