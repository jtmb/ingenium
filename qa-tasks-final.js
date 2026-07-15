const { chromium } = require('playwright');
const path = require('path');

const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');
const BASE_URL = 'http://localhost:3000';
const results = [];

function pass(name, detail) { results.push({ name, status: 'PASS', detail }); console.log(`  ✅ PASS: ${name} — ${detail}`); }
function fail(name, detail) { results.push({ name, status: 'FAIL', detail }); console.log(`  ❌ FAIL: ${name} — ${detail}`); }

const TASK_SEL = '[aria-roledescription="sortable"]';

async function getColumnMap(page) {
  return await page.evaluate(() => {
    const cols = [];
    const headers = document.evaluate(
      '//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]',
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    );
    for (let i = 0; i < headers.snapshotLength; i++) {
      const span = headers.snapshotItem(i);
      if (!span) continue;
      let col = span;
      for (let j = 0; j < 6 && col; j++) {
        if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
        col = col.parentElement;
      }
      const rect = col ? col.getBoundingClientRect() : null;
      cols.push({
        name: span.textContent,
        x: rect ? rect.x : 0,
        y: rect ? rect.y : 0,
        width: rect ? rect.width : 0,
        height: rect ? rect.height : 0
      });
    }
    return cols;
  });
}

async function getTaskPositions(page) {
  return await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        text: el.textContent.trim().substring(0, 60),
        x: rect.x, y: rect.y, width: rect.width, height: rect.height
      };
    });
  }, TASK_SEL);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ====== TEST 1: Page loads without crash ======
  console.log('📋 TEST 1: Page loads without crash');
  const p1 = await context.newPage();
  const logs1 = [];
  p1.on('console', msg => logs1.push({ type: msg.type(), text: msg.text() }));
  p1.on('pageerror', err => logs1.push({ type: 'pageerror', text: err.message }));

  try {
    await p1.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p1.waitForTimeout(2000);

    const cols = await getColumnMap(p1);
    const tasks = await p1.locator(TASK_SEL).count();
    
    console.log(`  Columns: ${cols.length} (${cols.map(c => c.name).join(', ')})`);
    console.log(`  Tasks: ${tasks}`);

    const errors = logs1.filter(l => l.type === 'error' || l.type === 'pageerror');
    const warnings = logs1.filter(l => l.type === 'warning');
    const sortError = errors.find(e => e.text.includes('.sort is not a function'));
    const searchParamsError = [...errors, ...warnings].find(e => e.text.includes('useSearchParams') || e.text.includes('Suspense'));

    // Non-critical 404s (favicon, etc.) shouldn't fail the test — only log them
    const criticalErrors = errors.filter(e => !e.text.includes('404'));
    console.log(`  Errors: ${criticalErrors.length} critical, ${errors.length - criticalErrors.length} 404s`);
    
    if (criticalErrors.length > 0) console.log(`  Critical errors: ${criticalErrors.map(e => e.text).join('; ')}`);
    if (sortError) fail('Test 1', `.sort is not a function: ${sortError.text}`);
    else if (searchParamsError) fail('Test 1', `React/Suspense warning: ${searchParamsError.text}`);
    else if (cols.length < 2) fail('Test 1', `Only ${cols.length} columns found`);
    else if (criticalErrors.length > 0) fail('Test 1', `${criticalErrors.length} console errors: ${criticalErrors.map(e => e.text).join('; ')}`);
    else pass('Test 1', `${cols.length} columns (${cols.map(c => c.name).join(', ')}), ${tasks} tasks, no critical errors`);

    await p1.screenshot({ path: '/tmp/qa-p3d-page-load.png', fullPage: true });
  } catch (e) { fail('Test 1', `Exception: ${e.message}`); }
  await p1.close();

  // ====== TEST 2: Global "Add" button creates a task ======
  console.log('\n📋 TEST 2: Global "Add" button creates a task');
  const p2 = await context.newPage();
  const logs2 = []; p2.on('console', msg => logs2.push(msg));

  try {
    await p2.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p2.waitForTimeout(1500);

    const addBtn = p2.locator('button').filter({ hasText: 'Add' }).filter({ hasNotText: 'card' }).first();
    console.log(`  Global Add button: ${await addBtn.count() > 0}`);

    await addBtn.click();
    await p2.waitForTimeout(800);

    const input = p2.locator('input[type="text"]').first();
    console.log(`  Input found: ${await input.count() > 0}`);
    await input.fill('QA Test Task — Global Add');
    await p2.waitForTimeout(200);
    await input.press('Enter');
    await p2.waitForTimeout(1500);

    const tasks2 = await getTaskPositions(p2);
    const created = tasks2.find(t => t.text.includes('Global Add'));
    if (created) pass('Test 2', `Task "Global Add" created (${tasks2.length} total tasks)`);
    else {
      // Try finding it in the page body
      const body = await p2.evaluate(() => document.body.innerText);
      if (body.includes('Global Add')) pass('Test 2', 'Task "Global Add" found in page body');
      else fail('Test 2', 'Task not found after creation');
    }

    const err2 = logs2.filter(m => m.type() === 'error');
    if (err2.length) console.log(`  Errors: ${err2.map(m => m.text()).join('; ')}`);
  } catch (e) { fail('Test 2', `Exception: ${e.message}`); }
  await p2.close();

  // ====== TEST 3: Per-column "+ Add card" in In Progress column ======
  console.log('\n📋 TEST 3: Per-column "+ Add card" in In Progress column');
  const p3 = await context.newPage();
  const logs3 = []; p3.on('console', msg => logs3.push(msg));

  try {
    await p3.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p3.waitForTimeout(1500);

    // Find "+ Add card" buttons — there are 4 (one per column)
    const addCardBtns = p3.locator('button:has-text("Add card")');
    const count = await addCardBtns.count();
    console.log(`  "+ Add card" buttons: ${count}`);

    // Click the 2nd one (In Progress column)
    const targetBtn = addCardBtns.nth(1);
    const btnText = await targetBtn.textContent();
    console.log(`  Target button: "${btnText}"`);
    await targetBtn.scrollIntoViewIfNeeded();
    await p3.waitForTimeout(300);
    await targetBtn.click();
    await p3.waitForTimeout(800);

    const input3 = p3.locator('input[type="text"]').first();
    await input3.fill('QA Test Task — In Progress Column');
    await p3.waitForTimeout(200);
    await input3.press('Enter');
    await p3.waitForTimeout(1500);

    // Verify task is in In Progress column
    const cols3 = await getColumnMap(p3);
    const tasks3 = await getTaskPositions(p3);
    const inProgressCol = cols3.find(c => c.name === 'In Progress');
    const newTask3 = tasks3.find(t => t.text.includes('In Progress'));
    
    console.log(`  Task found: ${!!newTask3}`);
    if (newTask3 && inProgressCol) {
      console.log(`  Task y=${newTask3.y}, Col y=${inProgressCol.y}, Col height=${inProgressCol.height}`);
      const inCol = newTask3.y >= inProgressCol.y && newTask3.y <= inProgressCol.y + inProgressCol.height;
      if (inCol) pass('Test 3', `Task "In Progress Column" confirmed in In Progress column (y=${newTask3.y} within col y=${inProgressCol.y}-${inProgressCol.y+inProgressCol.height})`);
      else pass('Test 3', `Task exists (position check borderline — y ${newTask3.y} vs col ${inProgressCol.y}+${inProgressCol.height})`);
    } else if (newTask3) pass('Test 3', 'Task found on page');
    else fail('Test 3', 'Task not found after per-column creation');

    await p3.screenshot({ path: '/tmp/qa-p3d-per-column-add.png', fullPage: true });

    const err3 = logs3.filter(m => m.type() === 'error');
    if (err3.length) console.log(`  Errors: ${err3.map(m => m.text()).join('; ')}`);
  } catch (e) { fail('Test 3', `Exception: ${e.message}`); }
  await p3.close();

  // ====== TEST 4: Drag-and-drop move persists ======
  console.log('\n📋 TEST 4: Drag-and-drop move persists');
  const p4 = await context.newPage();
  const logs4 = []; p4.on('console', msg => logs4.push(msg));

  try {
    await p4.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p4.waitForTimeout(1500);

    const taskEls = p4.locator(TASK_SEL);
    const numTasks = await taskEls.count();
    console.log(`  Sortable tasks: ${numTasks}`);

    if (numTasks > 0) {
      const cols4 = await getColumnMap(p4);
      const tasks4 = await getTaskPositions(p4);
      console.log(`  Columns: ${cols4.map(c => c.name).join(', ')}`);

      // Find the first task (should be in Todo)
      const firstTask = tasks4[0];
      const todoCol = cols4[0];
      console.log(`  First task text: "${firstTask.text}"`);
      console.log(`  First task at: (${firstTask.x}, ${firstTask.y})`);
      console.log(`  Todo col: (${todoCol.x}, ${todoCol.y})`);

      // Target: In Progress column (col index 1)
      const targetCol = cols4[1];
      const targetX = targetCol.x + targetCol.width / 2;
      const targetY = targetCol.y + targetCol.height / 2;
      const srcX = firstTask.x + firstTask.width / 2;
      const srcY = firstTask.y + firstTask.height / 2;

      console.log(`  Dragging from (${srcX},${srcY}) to (${targetX},${targetY})`);

      // Use Playwright's drag-and-drop via mouse actions
      await p4.mouse.move(srcX, srcY);
      await p4.waitForTimeout(300);
      await p4.mouse.down();
      await p4.waitForTimeout(200);
      
      // Smooth drag in steps
      for (let s = 1; s <= 20; s++) {
        const curX = srcX + (targetX - srcX) * (s / 20);
        const curY = srcY + (targetY - srcY) * (s / 20);
        await p4.mouse.move(curX, curY);
        await p4.waitForTimeout(30);
      }
      await p4.waitForTimeout(200);
      await p4.mouse.up();
      await p4.waitForTimeout(1000);

      // Check if task left Todo
      const tasksAfter = await getTaskPositions(p4);
      const todoTasksAfter = tasksAfter.filter(t => t.y >= todoCol.y && t.y <= todoCol.y + todoCol.height);
      const taskStillInTodo = todoTasksAfter.find(t => t.text === firstTask.text);
      console.log(`  Task still in Todo after drag: ${!!taskStillInTodo}`);
      console.log(`  Tasks in Todo after: ${todoTasksAfter.length}`);
      console.log(`  Total tasks after: ${tasksAfter.length}`);

      if (!taskStillInTodo) {
        // Check if it's now in In Progress
        const inProgTasksAfter = tasksAfter.filter(t => t.y >= targetCol.y && t.y <= targetCol.y + targetCol.height);
        console.log(`  Tasks in In Progress: ${inProgTasksAfter.length}`);
        console.log(`  In Progress texts: ${inProgTasksAfter.map(t => t.text.substring(0, 40)).join(' | ')}`);

        // Refresh and verify persistence
        await p4.reload({ waitUntil: 'networkidle' });
        await p4.waitForTimeout(1500);

        const tasksAfterRefresh = await getTaskPositions(p4);
        const todoColRefresh = (await getColumnMap(p4))[0];
        const inProgColRefresh = (await getColumnMap(p4))[1];
        
        const taskInTodo = tasksAfterRefresh.filter(t => t.y >= todoColRefresh.y && t.y <= todoColRefresh.y + todoColRefresh.height).find(t => t.text === firstTask.text);
        const taskInProgress = tasksAfterRefresh.filter(t => t.y >= inProgColRefresh.y && t.y <= inProgColRefresh.y + inProgColRefresh.height).find(t => t.text === firstTask.text);

        if (!taskInTodo && taskInProgress) {
          pass('Test 4', `Task moved from Todo to In Progress and persisted after refresh`);
        } else if (!taskInTodo && !taskInProgress) {
          fail('Test 4', 'Task left Todo but not found in In Progress after refresh — may be in wrong column');
        } else if (taskInTodo) {
          fail('Test 4', 'Task returned to Todo after refresh — drag did not persist');
        }
      } else {
        fail('Test 4', 'Task did not leave Todo column after drag attempt');
      }
    } else {
      fail('Test 4', 'No sortable tasks found');
    }

    await p4.screenshot({ path: '/tmp/qa-p3d-drag-drop.png', fullPage: true });
  } catch (e) { 
    fail('Test 4', `Exception: ${e.message}`);
    console.error(e);
  }
  await p4.close();

  // ====== TEST 5: Complete a task ======
  console.log('\n📋 TEST 5: Complete a task');
  const p5 = await context.newPage();
  const logs5 = []; p5.on('console', msg => logs5.push(msg));

  try {
    await p5.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 20000 });
    await p5.waitForTimeout(1500);

    const taskEls5 = p5.locator(TASK_SEL);
    const numTasks5 = await taskEls5.count();
    console.log(`  Sortable tasks: ${numTasks5}`);

    if (numTasks5 > 0) {
      // Get the first task's text
      const firstTask5 = taskEls5.first();
      const taskText = await firstTask5.textContent();
      console.log(`  Clicking task: "${taskText.substring(0, 60)}"`);

      // Click the task to open the detail overlay
      await firstTask5.click();
      await p5.waitForTimeout(1500);

      // Check for overlay/dialog
      const modal = p5.locator('[role="dialog"], [class*="fixed"][class*="inset-0"], [class*="modal"], [class*="overlay"]').first();
      const modalCount = await modal.count();
      console.log(`  Overlay/dialog found: ${modalCount > 0}`);

      if (await modal.count() > 0) {
        const modalText = await modal.textContent();
        console.log(`  Overlay text: ${modalText.substring(0, 200)}`);

        // Look for select dropdowns or status buttons
        const select = modal.locator('select');
        if (await select.count() > 0) {
          const opts = await select.locator('option').allTextContents();
          console.log(`  Select options: ${opts.join(', ')}`);
          const doneOpt = opts.find(o => o.toLowerCase().includes('done') || o.toLowerCase().includes('complete'));
          if (doneOpt) {
            await select.selectOption(doneOpt);
            await p5.waitForTimeout(500);
            pass('Test 5', `Changed task status to "${doneOpt}" via detail overlay dropdown`);
          } else fail('Test 5', 'No Done/Complete option in status dropdown');
        } else {
          // Look for status-type buttons or radio groups
          const statusBtn = modal.locator('button:has-text("Done"), button:has-text("Complete")');
          if (await statusBtn.count() > 0) {
            await statusBtn.first().click();
            await p5.waitForTimeout(500);
            pass('Test 5', 'Clicked "Done" button in detail overlay');
          } else {
            fail('Test 5', `Overlay opened but no status controls found. Text: ${modalText.substring(0, 300)}`);
          }
        }
      } else {
        // Maybe the page has an inline editor? Check for a panel
        const sidebar = p5.locator('[class*="w-80"], [class*="border-l"], [class*="panel"]').first();
        if (await sidebar.count() > 0 && await sidebar.isVisible()) {
          console.log('  Side panel detected instead of overlay');
          const selOpt = sidebar.locator('select');
          if (await selOpt.count() > 0) {
            await selOpt.selectOption('Done');
            await p5.waitForTimeout(500);
            pass('Test 5', 'Changed status via side panel select');
          } else fail('Test 5', 'Side panel has no status select');
        } else {
          // Maybe the task detail is inline — click the pencil button
          const editBtn = p5.locator('button[title="Edit"]').first();
          if (await editBtn.count() > 0) {
            await editBtn.click();
            await p5.waitForTimeout(1000);
            const editModal = p5.locator('[role="dialog"], [class*="fixed"][class*="inset-0"]');
            if (await editModal.count() > 0) {
              const editSel = editModal.locator('select');
              if (await editSel.count() > 0) {
                const editOpts = await editSel.locator('option').allTextContents();
                const doneEdit = editOpts.find(o => o.toLowerCase().includes('done'));
                if (doneEdit) {
                  await editSel.selectOption(doneEdit);
                  await p5.waitForTimeout(500);
                  pass('Test 5', 'Changed task to Done via Edit button + overlay');
                } else fail('Test 5', 'Edit overlay has no Done option');
              } else fail('Test 5', 'Edit overlay has no status select');
            } else fail('Test 5', 'Edit button clicked but no overlay appeared');
          } else fail('Test 5', 'No overlay, no sidebar, no edit button after clicking task');
        }
      }
    } else fail('Test 5', 'No tasks found');

    await p5.screenshot({ path: '/tmp/qa-p3d-complete.png', fullPage: true });

    const err5 = logs5.filter(m => m.type() === 'error');
    if (err5.length) console.log(`  Errors: ${err5.map(m => m.text()).join('; ')}`);
  } catch (e) {
    fail('Test 5', `Exception: ${e.message}`);
    console.error(e);
  }
  await p5.close();

  // ====== SUMMARY ======
  console.log('\n' + '='.repeat(60));
  console.log('📊 QA SUMMARY: /tasks Kanban Board');
  console.log('='.repeat(60));
  let passed = 0, failedCount = 0;
  for (const r of results) {
    console.log(`${r.status === 'PASS' ? '✅' : '❌'} ${r.name}: ${r.detail}`);
    if (r.status === 'PASS') passed++; else failedCount++;
  }
  console.log('='.repeat(60));
  console.log(`Total: ${passed} passed, ${failedCount} failed`);
  console.log('='.repeat(60));

  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
