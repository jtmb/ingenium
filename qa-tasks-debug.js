const { chromium } = require('playwright');
const path = require('path');

const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const msgs = [];
  page.on('console', msg => msgs.push(msg));

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Full page HTML to understand structure
  const html = await page.content();
  console.log('=== PAGE TITLE ===');
  console.log(await page.title());
  
  console.log('\n=== BODY TEXT (first 2000 chars) ===');
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log(bodyText.substring(0, 2000));

  console.log('\n=== ALL DATA-TESTID ATTRIBUTES ===');
  const testIds = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-testid]');
    return Array.from(els).map(el => `${el.tagName}: ${el.getAttribute('data-testid')}`);
  });
  console.log(testIds.join('\n'));

  console.log('\n=== ALL BUTTONS ===');
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent.trim().substring(0, 50),
      testId: b.getAttribute('data-testid') || 'none',
      classes: b.className.substring(0, 60)
    }));
  });
  buttons.forEach(b => console.log(`  button: "${b.text}" testId="${b.testId}" class="${b.classes}"`));

  console.log('\n=== ALL INPUTS ===');
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map(i => ({
      tag: i.tagName,
      type: i.getAttribute('type') || '',
      placeholder: i.getAttribute('placeholder') || '',
      testId: i.getAttribute('data-testid') || 'none',
      visible: i.offsetParent !== null
    }));
  });
  inputs.forEach(i => console.log(`  ${i.tag} type="${i.type}" placeholder="${i.placeholder}" visible=${i.visible}`));

  console.log('\n=== ALL HEADINGS ===');
  const headings = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => h.textContent.trim());
  });
  headings.forEach(h => console.log(`  ${h}`));

  console.log('\n=== ALL SELECTS ===');
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(s => ({
      options: Array.from(s.options).map(o => o.text)
    }));
  });
  selects.forEach(s => console.log(`  options: ${s.options.join(', ')}`));

  console.log('\n=== CONSOLE MESSAGES ===');
  msgs.forEach(m => console.log(`  [${m.type()}] ${m.text()}`));

  await page.screenshot({ path: '/tmp/qa-debug-page.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/qa-debug-page.png');

  await browser.close();
})();
