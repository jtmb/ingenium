const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // Test: Edit button click produces dialog/modal
  console.log('=== TEST: EDIT BUTTON BEHAVIOR ===');
  const p1 = await context.newPage();
  await p1.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p1.waitForTimeout(1500);

  // Hover over first task
  const taskCard = p1.locator('[aria-roledescription="sortable"]').first();
  const taskText = await taskCard.textContent();
  console.log(`  Task: "${taskText.trim().substring(0, 60)}"`);

  await taskCard.hover();
  await p1.waitForTimeout(500);

  // Click the edit button
  const editBtn = p1.locator('button[title="Edit"]').first();
  await editBtn.click();
  await p1.waitForTimeout(1500);

  // Capture the full page state
  const pageState = await p1.evaluate(() => {
    const results = {};
    
    // Check for overlays/modals/dialogs
    const overlays = document.querySelectorAll('[role="dialog"], [role="presentation"], [class*="fixed"], [class*="modal"], [class*="overlay"]');
    results.overlayCount = overlays.length;
    results.overlays = Array.from(overlays).slice(0, 10).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      class: el.className?.substring(0, 100),
      visible: el.offsetParent !== null,
      zIndex: el.style?.zIndex,
      text: el.textContent?.trim().substring(0, 150)
    }));
    
    // Check for new inputs, selects, textareas
    const allInputs = document.querySelectorAll('input, select, textarea');
    results.inputs = Array.from(allInputs).map(i => ({
      tag: i.tagName,
      type: i.getAttribute('type') || '',
      placeholder: i.getAttribute('placeholder') || '',
      visible: i.offsetParent !== null,
      name: i.getAttribute('name') || ''
    }));
    
    // Look for task detail panel/section
    const detailPanel = document.querySelector('[class*="border-l"][class*="w-"], [class*="panel"], [class*="detail"]');
    results.detailPanel = detailPanel ? {
      class: detailPanel.className?.substring(0, 100),
      text: detailPanel.textContent?.trim().substring(0, 200),
      visible: detailPanel.offsetParent !== null
    } : null;
    
    // Check if URL changed
    results.url = window.location.href;
    
    // Check for any newly mounted React portal
    const portals = document.querySelectorAll('[class*="portal"], [id*="portal"]');
    results.portals = portals.length;
    
    return results;
  });
  console.log(`  Page state after edit click:`);
  console.log(`  Overlays: ${pageState.overlayCount}`);
  pageState.overlays.forEach((o, i) => console.log(`    [${i}] ${JSON.stringify(o)}`));
  console.log(`  Inputs: ${pageState.inputs.length}`);
  pageState.inputs.forEach(i => console.log(`    ${JSON.stringify(i)}`));
  if (pageState.detailPanel) console.log(`  Detail panel: ${JSON.stringify(pageState.detailPanel)}`);
  console.log(`  URL: ${pageState.url}`);

  // Try clicking the task card directly
  console.log('\n=== TEST: TASK CARD DIRECT CLICK ===');
  const p2 = await context.newPage();
  await p2.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p2.waitForTimeout(1500);

  const task2 = p2.locator('[aria-roledescription="sortable"]').first();
  await task2.click();
  await p2.waitForTimeout(1500);

  const pageState2 = await p2.evaluate(() => {
    return {
      overlays: document.querySelectorAll('[role="dialog"]').length,
      fixedEls: document.querySelectorAll('[class*="fixed"]').length,
      selects: document.querySelectorAll('select').length,
      inputs: document.querySelectorAll('input:not([type="hidden"])').length,
      url: window.location.href
    };
  });
  console.log(`  After click: overlays=${pageState2.overlays}, fixed=${pageState2.fixedEls}, selects=${pageState2.selects}, inputs=${pageState2.inputs}`);

  // Try checking for a contextual menu or inline edit
  console.log('\n=== TEST: INLINE EDIT MODE ===');
  const p3 = await context.newPage();
  await p3.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p3.waitForTimeout(1500);

  // Try double-clicking a task
  const task3 = p3.locator('[aria-roledescription="sortable"]').first();
  await task3.dblclick();
  await p3.waitForTimeout(1500);

  const pageState3 = await p3.evaluate(() => {
    return {
      overlays: document.querySelectorAll('[role="dialog"]').length,
      selects: document.querySelectorAll('select').length,
      inputs: document.querySelectorAll('input:not([type="hidden"])').length
    };
  });
  console.log(`  After dblclick: overlays=${pageState3.overlays}, selects=${pageState3.selects}, inputs=${pageState3.inputs}`);

  // Inspect DnD library more closely
  console.log('\n=== DnD LIBRARY ===');
  const dndInfo = await p3.evaluate(() => {
    const sortable = document.querySelector('[aria-roledescription="sortable"]');
    if (!sortable) return 'no sortable';
    
    const handlers = {};
    const reactKey = Object.keys(sortable).find(k => k.startsWith('__reactProps'));
    if (reactKey) {
      const props = sortable[reactKey];
      for (const key of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onMouseDown', 'onDragStart', 'onDragOver', 'onDrop']) {
        handlers[key] = props[key] ? props[key].toString().substring(0, 80) : undefined;
      }
      handlers['aria-roledescription'] = sortable.getAttribute('aria-roledescription');
      handlers['aria-describedby'] = sortable.getAttribute('aria-describedby');
    }
    
    // Check for @dnd-kit context
    const body = document.body;
    const reactKeys = Object.keys(body).filter(k => k.startsWith('__reactFiber'));
    const fiberData = reactKeys.length > 0 ? 'found' : 'not found';
    
    // Check what scripts are loaded
    const scripts = Array.from(document.scripts).map(s => s.src).filter(s => s.includes('dnd') || s.includes('drag') || s.includes('sort'));
    
    return { handlers, fiberData, scripts };
  });
  console.log(`  ${JSON.stringify(dndInfo, null, 2)}`);

  await browser.close();
})();
