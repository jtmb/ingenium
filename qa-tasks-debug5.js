const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // Test: the global "Add" button — just type in the existing input and press Enter,
  // or click Add after typing
  console.log('=== TEST: GLOBAL ADD FLOW ===');
  const p1 = await context.newPage();
  await p1.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p1.waitForTimeout(1500);

  const topInput = p1.locator('input[placeholder*="Task title"]').first();
  console.log(`  Top input placeholder: "${await topInput.getAttribute('placeholder')}"`);
  await topInput.fill('QA Global Add Test');
  await p1.waitForTimeout(300);
  
  // Try clicking Add
  const addBtn = p1.locator('button:has-text("Add")').filter({ hasNotText: 'card' }).first();
  console.log(`  Add button enabled: ${await addBtn.isEnabled()}`);
  await addBtn.click();
  await p1.waitForTimeout(1500);

  // Check input cleared (means it submitted)
  const inputVal = await topInput.inputValue();
  console.log(`  Input value after Add click: "${inputVal}"`);
  console.log(`  Input cleared: ${inputVal === ''}`);

  // Check task count
  const tasks1 = await p1.evaluate(() => document.querySelectorAll('[aria-roledescription="sortable"]').length);
  console.log(`  Tasks after Add: ${tasks1}`);

  // Try again with Enter key
  const p2 = await context.newPage();
  await p2.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p2.waitForTimeout(1500);

  const topInput2 = p2.locator('input[placeholder*="Task title"]').first();
  await topInput2.fill('QA Enter Key Test');
  await p2.waitForTimeout(300);
  await topInput2.press('Enter');
  await p2.waitForTimeout(1500);

  const tasks2 = await p2.evaluate(() => document.querySelectorAll('[aria-roledescription="sortable"]').length);
  console.log(`  Tasks after Enter: ${tasks2}`);

  const body2 = await p2.evaluate(() => document.body.innerText);
  console.log(`  Task found: ${body2.includes('QA Enter Key Test')}`);

  // Test: per-column Add card flow
  console.log('\n=== TEST: PER-COLUMN ADD CARD ===');
  const p3 = await context.newPage();
  await p3.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p3.waitForTimeout(1500);

  // Click "+ Add card" in the second column (In Progress)
  const addCards = p3.locator('button:has-text("Add card")');
  console.log(`  Add card buttons: ${await addCards.count()}`);

  await addCards.nth(1).scrollIntoViewIfNeeded();
  await p3.waitForTimeout(300);
  await addCards.nth(1).click();
  await p3.waitForTimeout(800);

  // Find the per-column input (placeholder "Task title...")
  const colInput = p3.locator('input[placeholder*="Task title..."]');
  console.log(`  Column input found: ${await colInput.count()}`);

  if (await colInput.count() > 0) {
    await colInput.fill('QA Per Column Test');
    await p3.waitForTimeout(200);
    await colInput.press('Enter');
    await p3.waitForTimeout(1500);

    const body3 = await p3.evaluate(() => document.body.innerText);
    console.log(`  Task found in page: ${body3.includes('QA Per Column Test')}`);

    // Check which column it's in
    const todos = body3.substring(0, body3.indexOf('In Progress'));
    const inProgress = body3.substring(body3.indexOf('In Progress'), body3.indexOf('Review'));
    console.log(`  Task in Todo section: ${todos.includes('QA Per Column Test')}`);
    console.log(`  Task in In Progress: ${inProgress.includes('QA Per Column Test')}`);
  }

  // Test: Click task and edit button
  console.log('\n=== TEST: TASK CLICK / EDIT ===');
  const p4 = await context.newPage();
  await p4.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p4.waitForTimeout(1500);

  // Hover over first task to show edit/delete buttons
  const taskCard = p4.locator('[aria-roledescription="sortable"]').first();
  const taskText = await taskCard.textContent();
  console.log(`  First task: "${taskText.substring(0, 60)}"`);

  await taskCard.hover();
  await p4.waitForTimeout(500);

  // Find the edit button
  const editBtn = p4.locator('button[title="Edit"]');
  console.log(`  Edit button visible: ${await editBtn.count()}`);
  if (await editBtn.count() > 0) {
    console.log(`  Edit button HTML: ${await editBtn.first().evaluate(el => el.outerHTML.substring(0, 200))}`);
    await editBtn.first().click();
    await p4.waitForTimeout(1000);

    // Check for ANY new dialog/overlay
    const dialogs = await p4.locator('[role="dialog"]').count();
    const fixed = await p4.locator('[class*="fixed inset"]').count();
    const newInputs = await p4.locator('input[type!="hidden"]').count();
    const selects = await p4.locator('select').count();
    console.log(`  Dialogs: ${dialogs}, Fixed overlays: ${fixed}, Inputs: ${newInputs}, Selects: ${selects}`);

    // Check if page body changed significantly
    if (selects > 0) {
      const selectDetails = await p4.evaluate(() => {
        return Array.from(document.querySelectorAll('select')).map(s => ({
          options: Array.from(s.options).map(o => o.text)
        }));
      });
      console.log(`  Select options: ${JSON.stringify(selectDetails)}`);
    }
    
    // Get new elements
    const newElements = await p4.evaluate(() => {
      return Array.from(document.querySelectorAll('[role="dialog"], [class*="fixed"], [class*="modal"], select, textarea')).map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        class: el.className.substring(0, 80),
        text: el.textContent.trim().substring(0, 100),
        visible: el.offsetParent !== null
      }));
    });
    console.log(`  New elements:`);
    newElements.forEach(e => console.log(`    ${JSON.stringify(e)}`));
  }

  // DnD Library detection
  console.log('\n=== DND LIBRARY ===');
  const dndDetect = await p4.evaluate(() => {
    const sortable = document.querySelector('[aria-roledescription="sortable"]');
    if (!sortable) return { error: 'no sortable found' };
    
    // Get React props
    const reactKey = Object.keys(sortable).find(k => k.startsWith('__reactProps'));
    if (reactKey) {
      const props = sortable[reactKey];
      const handlers = {};
      for (const key of ['onClick', 'onPointerDown', 'onMouseDown', 'onDragStart', 'onKeyDown']) {
        if (props[key]) handlers[key] = props[key].toString().substring(0, 100);
      }
      return { reactKey, handlers };
    }
    return { error: 'no react props found' };
  });
  console.log(`  DnD detection: ${JSON.stringify(dndDetect, null, 2)}`);

  await browser.close();
})();
