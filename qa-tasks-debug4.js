const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ---- Check what "Add" button does ----
  console.log('=== ADD BUTTON BEHAVIOR ===');
  const p1 = await context.newPage();
  await p1.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p1.waitForTimeout(1500);
  
  // Check initial input existence
  let inputCount = await p1.locator('input').count();
  console.log(`  Before Add click — inputs: ${inputCount}`);
  if (inputCount > 0) {
    const inputInfo = await p1.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type, placeholder: i.placeholder, visible: i.offsetParent !== null, id: i.id
      }));
    });
    console.log(`  Input details: ${JSON.stringify(inputInfo)}`);
  }

  // Click the global Add button
  const addBtn = p1.locator('button').filter({ hasText: 'Add' }).filter({ hasNotText: 'card' }).first();
  console.log(`  Global Add button text: "${await addBtn.textContent()}"`);
  await addBtn.click();
  await p1.waitForTimeout(1000);

  // Check inputs after click
  inputCount = await p1.locator('input').count();
  console.log(`  After Add click — inputs: ${inputCount}`);
  if (inputCount > 0) {
    const inputInfo = await p1.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type, placeholder: i.placeholder, visible: i.offsetParent !== null, id: i.id
      }));
    });
    console.log(`  Input details: ${JSON.stringify(inputInfo)}`);
  }

  // Maybe the input is a textarea or contenteditable?
  const textareas = await p1.locator('textarea').count();
  const contenteditables = await p1.evaluate(() => {
    return Array.from(document.querySelectorAll('[contenteditable="true"]')).length;
  });
  console.log(`  Textareas: ${textareas}, contenteditables: ${contenteditables}`);

  // Maybe the Add button navigates somewhere or opens a modal?
  const modal = p1.locator('[role="dialog"]');
  console.log(`  Dialogs after Add click: ${await modal.count()}`);

  // Check for data-testid on the add button
  const addBtnDetails = await p1.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const addBtns = btns.filter(b => b.textContent.trim() === 'Add');
    return addBtns.map(b => ({
      outerHTML: b.outerHTML.substring(0, 300),
      className: b.className
    }));
  });
  console.log(`\n  Add button HTML:`);
  addBtnDetails.forEach((b, i) => console.log(`    [${i}] class="${b.className}"\n    ${b.outerHTML}`));

  // Now check what "+ Add card" inside a column does
  console.log('\n=== + ADD CARD BEHAVIOR ===');
  const p2 = await context.newPage();
  await p2.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p2.waitForTimeout(1500);

  // Check the "+ Add card" button
  const addCards = p2.locator('button:has-text("Add card")');
  console.log(`  Add card buttons: ${await addCards.count()}`);
  const firstAddCard = addCards.first();
  console.log(`  Add card HTML: ${await firstAddCard.evaluate(el => el.outerHTML.substring(0, 300))}`);

  await firstAddCard.scrollIntoViewIfNeeded();
  await p2.waitForTimeout(300);
  await firstAddCard.click();
  await p2.waitForTimeout(1000);

  console.log(`  After click — inputs: ${await p2.locator('input').count()}`);
  console.log(`  After click — dialogs: ${await p2.locator('[role="dialog"]').count()}`);

  const allInputsAfter = await p2.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')).map(i => ({
      tag: i.tagName,
      type: i.getAttribute('type') || '',
      placeholder: i.getAttribute('placeholder') || '',
      visible: i.offsetParent !== null,
      id: i.id,
      outer: i.outerHTML.substring(0, 200)
    }));
  });
  console.log(`  All input-like elements:`);
  allInputsAfter.forEach(i => console.log(`    ${JSON.stringify(i)}`));

  // Check if the page changed after click
  console.log(`  URL: ${p2.url()}`);

  // ---- DnD investigation ----
  console.log('\n=== DRAG LIBRARY DETECTION ===');
  const dndInfo = await p2.evaluate(() => {
    // Check for @dnd-kit
    const hasDndKit = typeof window !== 'undefined' && 
      (document.querySelector('[data-dnd*]') || document.querySelector('[aria-roledescription="sortable"]'));
    
    // Check for react-beautiful-dnd
    const hasRbd = document.querySelector('[data-rbd*]');
    
    // Check for sortablejs
    const hasSortableJS = document.querySelector('[class*="sortable"]');
    
    // Check event listeners on sortable elements
    const sortable = document.querySelector('[aria-roledescription="sortable"]');
    let listeners = null;
    if (sortable) {
      const handlerKeys = Object.keys(sortable).filter(k => k.startsWith('__reactEventHandlers$') || k.startsWith('__reactProps$'));
      listeners = handlerKeys.map(k => ({ key: k, value: JSON.stringify(sortable[k]).substring(0, 200) }));
    }
    
    return { hasDndKit, hasRbd, hasSortableJS, listeners };
  });
  console.log(`  ${JSON.stringify(dndInfo, null, 2)}`);

  // ---- Try clicking the pencil (edit) button ----
  console.log('\n=== PENCIL (EDIT) BUTTON ===');
  const p3 = await context.newPage();
  await p3.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await p3.waitForTimeout(1500);

  // First hover over a task to reveal the edit/delete buttons
  const task = p3.locator('[aria-roledescription="sortable"]').first();
  await task.hover();
  await p3.waitForTimeout(500);

  const editBtn = p3.locator('button[title="Edit"]');
  console.log(`  Edit buttons visible: ${await editBtn.count()}`);
  if (await editBtn.count() > 0) {
    console.log(`  Edit button HTML: ${await editBtn.first().evaluate(el => el.outerHTML.substring(0, 200))}`);
    await editBtn.first().click();
    await p3.waitForTimeout(1000);
    
    const dialog = p3.locator('[role="dialog"]');
    const modal2 = p3.locator('[class*="fixed"]');
    const panel = p3.locator('[class*="panel" i]');
    console.log(`  Dialogs: ${await dialog.count()}, Fixed overlays: ${await modal2.count()}, Panels: ${await panel.count()}`);
    
    // Check what's new on the page
    const newElements = await p3.evaluate(() => {
      const allInputs = document.querySelectorAll('input, textarea, select');
      return Array.from(allInputs).map(i => ({
        tag: i.tagName, type: i.getAttribute('type') || '',
        placeholder: i.getAttribute('placeholder') || '',
        visible: i.offsetParent !== null
      }));
    });
    console.log(`  Inputs after edit click: ${JSON.stringify(newElements)}`);
  }

  await browser.close();
})();
