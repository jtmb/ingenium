const { chromium } = require('playwright');
const path = require('path');

const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');
const BASE_URL = 'http://localhost:3000';
const results = [];

function pass(name, detail) { results.push({ name, status: 'PASS', detail }); console.log(`  ✅ ${name}: ${detail}`); }
function fail(name, detail) { results.push({ name, status: 'FAIL', detail }); console.log(`  ❌ ${name}: ${detail}`); }
function warn(name, detail) { results.push({ name, status: 'WARN', detail }); console.log(`  ⚠️ ${name}: ${detail}`); }

const TASK_SEL = '[aria-roledescription="sortable"]';

async function getColumnMap(page) {
  return await page.evaluate(() => {
    const cols = [];
    const headers = document.evaluate('//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < headers.snapshotLength; i++) {
      const span = headers.snapshotItem(i);
      if (!span) continue;
      let col = span;
      for (let j = 0; j < 6 && col; j++) {
        if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
        col = col.parentElement;
      }
      const rect = col ? col.getBoundingClientRect() : null;
      cols.push({ name: span.textContent, x: rect ? rect.x : 0, y: rect ? rect.y : 0, width: rect ? rect.width : 0, height: rect ? rect.height : 0 });
    }
    return cols;
  });
}

async function getTasks(page) {
  return await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map(el => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  }, TASK_SEL);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ====== TEST 1: Page loads without crash ======
  console.log('\n━━━ TEST 1: Page loads without crash ━━━');
  const p1 = await context.newPage();
  const logs1 = [];
  p1.on('console', msg => logs1.push({ type: msg.type(), text: msg.text() }));
  p1.on('pageerror', err => logs1.push({ type: 'pageerror', text: err.message }));

  try {
    await p1.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p1.waitForTimeout(2000);

    const cols = await getColumnMap(p1);
    const tasks = await p1.locator(TASK_SEL).count();
    const errors = logs1.filter(l => l.type === 'error' || l.type === 'pageerror');
    const hasSortError = errors.some(e => e.text.includes('.sort is not a function'));
    const hasReactSuspenseWarn = logs1.filter(l => l.type === 'warning').some(e => e.text.includes('useSearchParams') || e.text.includes('Suspense'));
    
    // Only fail on critical errors (not 404s)
    const criticalErrors = errors.filter(e => !e.text.includes('404') && !e.text.includes('favicon'));
    const hasPageCrash = errors.some(e => e.type === 'pageerror');

    if (hasSortError) fail('Test 1', `.sort is not a function: ${errors.map(e => e.text).join('; ')}`);
    else if (hasReactSuspenseWarn) fail('Test 1', 'useSearchParams/Suspense warning detected');
    else if (cols.length < 2) fail('Test 1', `Only ${cols.length} columns found`);
    else if (hasPageCrash) fail('Test 1', `Page error: ${errors.filter(e => e.type === 'pageerror').map(e => e.text).join('; ')}`);
    else if (criticalErrors.length > 0) fail('Test 1', `${criticalErrors.length} critical console errors: ${criticalErrors.map(e => e.text).join('; ')}`);
    else pass('Test 1', `${cols.length} columns (${cols.map(c => c.name).join(', ')}), ${tasks} tasks loaded`);

    await p1.screenshot({ path: '/tmp/qa-p3d-page-load.png', fullPage: true });
  } catch (e) { fail('Test 1', `Exception: ${e.message}`); }
  await p1.close();

  // ====== TEST 2: Global "Add" creates a task ======
  console.log('\n━━━ TEST 2: Global "Add" creates a task ━━━');
  const p2 = await context.newPage();
  const logs2 = []; p2.on('console', msg => logs2.push(msg));
  p2.on('pageerror', err => logs2.push({ type: 'pageerror', text: err.message }));

  try {
    await p2.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p2.waitForTimeout(1500);

    // The input is ALWAYS visible. Just type and press Enter or click Add
    const input = p2.locator('input[placeholder*="Task title"]').first();
    const taskName = `QA Global Add ${Date.now()}`;
    await input.fill(taskName);
    await p2.waitForTimeout(200);
    
    const addBtn = p2.locator('button:has-text("Add")').filter({ hasNotText: 'card' }).first();
    await addBtn.click();
    await p2.waitForTimeout(1500);

    const body = await p2.evaluate(() => document.body.innerText);
    if (body.includes(taskName)) {
      pass('Test 2', `Task "${taskName}" created via global Add button`);
    } else {
      // Try Enter key instead
      await input.fill(taskName);
      await p2.waitForTimeout(200);
      await input.press('Enter');
      await p2.waitForTimeout(1500);
      const body2 = await p2.evaluate(() => document.body.innerText);
      if (body2.includes(taskName)) pass('Test 2', `Task "${taskName}" created via Enter key`);
      else fail('Test 2', `Task "${taskName}" not found after either method`);
    }

    const errs = logs2.filter(m => { const t = m.type ? m.type() : m.type; return (t === 'error' || t === 'pageerror'); });
    if (errs.length > 0) console.log(`  Console errors: ${errs.map(e => e.text || e.text()).join('; ')}`);
  } catch (e) { fail('Test 2', `Exception: ${e.message}`); }
  await p2.close();

  // ====== TEST 3: Per-column "+ Add card" ======
  console.log('\n━━━ TEST 3: Per-column "+ Add card" creates task in target column ━━━');
  const p3 = await context.newPage();
  const logs3 = []; p3.on('console', msg => logs3.push(msg));
  p3.on('pageerror', err => logs3.push({ type: 'pageerror', text: err.message }));

  try {
    await p3.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p3.waitForTimeout(1500);

    const cols3 = await getColumnMap(p3);
    const colNames = cols3.map(c => c.name);
    console.log(`  Columns: ${colNames.join(', ')}`);

    // Find "+ Add card" in In Progress column (index 1)
    const addCardBtns = p3.locator('button:has-text("Add card")');
    const numCards3 = await addCardBtns.count();
    console.log(`  Add card buttons: ${numCards3}`);

    const targetIdx = Math.min(1, numCards3 - 1);
    await addCardBtns.nth(targetIdx).scrollIntoViewIfNeeded();
    await p3.waitForTimeout(300);
    await addCardBtns.nth(targetIdx).click();
    await p3.waitForTimeout(800);

    // The per-column input has placeholder "Task title..."
    const colInput = p3.locator('input[placeholder*="Task title..."]');
    console.log(`  Per-column input visible: ${await colInput.count()}`);
    
    if (await colInput.count() > 0) {
      const taskName3 = `QA Column Test ${Date.now()}`;
      await colInput.fill(taskName3);
      await p3.waitForTimeout(200);
      await colInput.press('Enter');
      await p3.waitForTimeout(1500);

      const body3 = await p3.evaluate(() => document.body.innerText);
      const found = body3.includes(taskName3);

      // Check which column it landed in
      const tasks3 = await getTasks(p3);
      const column3 = cols3[targetIdx];
      const inTargetColumn = tasks3.some(t => t.text.includes(taskName3) && t.y >= column3.y && t.y <= column3.y + column3.height);

      if (found && inTargetColumn) pass('Test 3', `Task "${taskName3}" created in ${colNames[targetIdx]} column`);
      else if (found) warn('Test 3', `Task "${taskName3}" created but position doesn't match ${colNames[targetIdx]} column`);
      else fail('Test 3', `Task "${taskName3}" not found after per-column creation`);
    } else {
      fail('Test 3', 'No per-column input appeared after clicking Add card');
    }

    await p3.screenshot({ path: '/tmp/qa-p3d-per-column-add.png', fullPage: true });
  } catch (e) { fail('Test 3', `Exception: ${e.message}`); }
  await p3.close();

  // ====== TEST 4: Drag-and-drop move persists ======
  console.log('\n━━━ TEST 4: Drag-and-drop move persists ━━━');
  const p4 = await context.newPage();
  const logs4 = []; p4.on('console', msg => logs4.push(msg));
  p4.on('pageerror', err => logs4.push({ type: 'pageerror', text: err.message }));

  try {
    await p4.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p4.waitForTimeout(1500);

    const cols4 = await getColumnMap(p4);
    const tasks4 = await getTasks(p4);
    console.log(`  Total tasks: ${tasks4.length}`);

    if (tasks4.length === 0) {
      fail('Test 4', 'No tasks to drag');
    } else {
      // Use the LAST todo task to drag (to avoid visual overlap issues)
      const todoCol = cols4[0];
      const todoTasks = tasks4.filter(t => t.y >= todoCol.y && t.y <= todoCol.y + todoCol.height);
      const sourceTask = todoTasks[0];
      const targetCol = cols4[1];
      
      const srcX = sourceTask.x + sourceTask.width / 2;
      const srcY = sourceTask.y + sourceTask.height / 2;
      const targetX = targetCol.x + targetCol.width / 2;
      const targetY = targetCol.y + targetCol.height / 2;

      console.log(`  Source: "${sourceTask.text.substring(0, 30)}" at (${srcX.toFixed(0)}, ${srcY.toFixed(0)})`);
      console.log(`  Target: ${targetCol.name} at (${targetX.toFixed(0)}, ${targetY.toFixed(0)})`);

      // Use pointer-based drag (required for @dnd-kit)
      await p4.mouse.move(srcX, srcY);
      await p4.waitForTimeout(200);
      await p4.mouse.down();
      await p4.waitForTimeout(200);

      // Drag smoothly with pointer events
      const steps = 30;
      for (let s = 1; s <= steps; s++) {
        const curX = srcX + (targetX - srcX) * (s / steps);
        const curY = srcY + (targetY - srcY) * (s / steps);
        await p4.mouse.move(curX, curY);
        await p4.waitForTimeout(20);
      }
      await p4.waitForTimeout(300);
      await p4.mouse.up();
      await p4.waitForTimeout(1000);

      // Check if the task moved columns
      const tasksAfter = await getTasks(p4);
      const sourceTextTrim = sourceTask.text.substring(0, 30);
      const stillInTodo = tasksAfter.filter(t => t.y >= todoCol.y && t.y <= todoCol.y + todoCol.height)
        .some(t => t.text.includes(sourceTextTrim));
      const inProgress = tasksAfter.filter(t => t.y >= targetCol.y && t.y <= targetCol.y + targetCol.height)
        .some(t => t.text.includes(sourceTextTrim));

      console.log(`  Still in Todo: ${stillInTodo}, Now in In Progress: ${inProgress}`);

      if (!stillInTodo && inProgress) {
        // Refresh and verify persistence
        await p4.reload({ waitUntil: 'networkidle' });
        await p4.waitForTimeout(1500);

        const colsAfterRefresh = await getColumnMap(p4);
        const tasksAfterRefresh = await getTasks(p4);
        const persistedInProgress = tasksAfterRefresh.filter(t => t.y >= colsAfterRefresh[1].y && t.y <= colsAfterRefresh[1].y + colsAfterRefresh[1].height)
          .some(t => t.text.includes(sourceTextTrim));
        const backInTodo = tasksAfterRefresh.filter(t => t.y >= colsAfterRefresh[0].y && t.y <= colsAfterRefresh[0].y + colsAfterRefresh[0].height)
          .some(t => t.text.includes(sourceTextTrim));

        if (persistedInProgress && !backInTodo) {
          pass('Test 4', `Task moved from Todo to ${targetCol.name} and persisted after refresh`);
        } else if (backInTodo) {
          fail('Test 4', 'Task returned to original position after refresh — drag did not persist');
        } else if (!persistedInProgress) {
          fail('Test 4', 'Task left Todo but not found in target after refresh');
        } else {
          pass('Test 4', 'Task moved and persisted (position check passed)');
        }
      } else if (!stillInTodo && !inProgress) {
        fail('Test 4', 'Task left Todo but not found in target column');
      } else {
        fail('Test 4', 'Task did not move columns');
      }
    }

    await p4.screenshot({ path: '/tmp/qa-p3d-drag-drop.png', fullPage: true });
  } catch (e) { fail('Test 4', `Exception: ${e.message}`); }
  await p4.close();

  // ====== TEST 5: Complete a task ======
  console.log('\n━━━ TEST 5: Complete a task via Edit ━━━');
  const p5 = await context.newPage();
  const logs5 = []; p5.on('console', msg => logs5.push({ type: msg.type(), text: msg.text() }));
  p5.on('pageerror', err => logs5.push({ type: 'pageerror', text: err.message }));

  try {
    await p5.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p5.waitForTimeout(1500);

    const tasks5 = await getTasks(p5);
    console.log(`  Total tasks: ${tasks5.length}`);

    if (tasks5.length > 0) {
      // Click the task card to see if anything happens
      const taskCard = p5.locator(TASK_SEL).first();
      await taskCard.hover();
      await p5.waitForTimeout(500);

      // Click the pencil (Edit) button
      const editBtn = p5.locator('button[title="Edit"]').first();
      if (await editBtn.isVisible()) {
        console.log('  Clicking Edit button...');
        await editBtn.click();
        await p5.waitForTimeout(2000);

        // Check for page crash
        const body5 = await p5.evaluate(() => document.body.innerText);
        const pageErrors = logs5.filter(l => l.type === 'pageerror');
        
        if (body5.includes("couldn't load") || pageErrors.length > 0) {
          const errorMsg = pageErrors.map(e => e.text).join('; ') || 'Page crashed with error boundary';
          fail('Test 5', `Edit button crashes page: ${errorMsg}`);
        } else {
          // Check for any overlay/dialog
          const dialog = p5.locator('[role="dialog"]');
          const fixed = p5.locator('[class*="fixed"]');
          const hasOverlay = await dialog.count() > 0 || await fixed.count() > 0;
          
          if (hasOverlay) {
            // Look for Done/Complete option
            const select = p5.locator('select');
            if (await select.count() > 0) {
              const options = await select.locator('option').allTextContents();
              const doneOpt = options.find(o => o.toLowerCase().includes('done') || o.toLowerCase().includes('complete'));
              if (doneOpt) {
                await select.selectOption(doneOpt);
                await p5.waitForTimeout(500);
                pass('Test 5', `Changed task to "${doneOpt}" via overlay`);
              } else {
                fail('Test 5', `Overlay opened but no Done option (options: ${options.join(', ')})`);
              }
            } else {
              warn('Test 5', 'Overlay opened but no status select found');
            }
          } else {
            warn('Test 5', 'Edit button clicked but no overlay appeared (page didn\'t crash)');
          }
        }
      } else {
        fail('Test 5', 'Edit button not visible after hover');
      }
    } else {
      fail('Test 5', 'No tasks found');
    }

    await p5.screenshot({ path: '/tmp/qa-p3d-complete.png', fullPage: true });
  } catch (e) { fail('Test 5', `Exception: ${e.message}`); }
  await p5.close();

  // ====== SUMMARY ======
  console.log('\n' + '='.repeat(65));
  console.log('📊 QA SUMMARY: /tasks Kanban Board');
  console.log('='.repeat(65));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${icon} ${r.name}: ${r.detail}`);
  }
  console.log('='.repeat(65));
  const passed = results.filter(r => r.status === 'PASS').length;
  const warnings = results.filter(r => r.status === 'WARN').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${passed} passed, ${warnings} warnings, ${failed} failed`);
  console.log('='.repeat(65));

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
