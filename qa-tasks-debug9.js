const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Get column positions
  const cols = await page.evaluate(() => {
    const headers = document.evaluate('//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const results = [];
    for (let i = 0; i < headers.snapshotLength; i++) {
      const span = headers.snapshotItem(i);
      if (!span) continue;
      let col = span;
      for (let j = 0; j < 6 && col; j++) {
        if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
        col = col.parentElement;
      }
      const rect = col ? col.getBoundingClientRect() : null;
      results.push({ name: span.textContent, x: rect.x, y: rect.y, w: rect.width, h: rect.height, bottom: rect.y + rect.height });
    }
    return results;
  });
  console.log('=== COLUMN POSITIONS ===');
  cols.forEach(c => console.log(`  ${c.name}: x=${c.x} y=${c.y} w=${c.w} h=${c.h} bottom=${c.bottom}`));

  // Get task positions
  const tasks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[aria-roledescription="sortable"]')).map(el => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent.trim().substring(0, 50), y: rect.y, h: rect.height, bottom: rect.y + rect.height };
    });
  });
  console.log('\n=== TASK POSITIONS ===');
  tasks.forEach((t, i) => console.log(`  [${i}] "${t.text}" y=${t.y} h=${t.h} bottom=${t.bottom}`));

  // Find which column each task is in
  console.log('\n=== TASK COLUMN ASSIGNMENT ===');
  tasks.forEach(t => {
    const inCol = cols.find(c => t.y >= c.y && t.y <= c.y + c.h);
    console.log(`  "${t.text}" → ${inCol ? inCol.name : 'UNKNOWN'}`);
  });

  // Try DnD with dispatchEvent approach
  console.log('\n=== DND WITH DISPATCH EVENT ===');
  const todoTasks = await page.evaluate(() => {
    const todoCol = Array.from(document.querySelectorAll('[aria-roledescription="sortable"]'));
    // Just get the first task (should be in Todo)
    return todoCol.slice(0, 3).map(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: el.textContent.trim().substring(0, 40) };
    });
  });

  if (todoTasks.length > 0) {
    const src = todoTasks[0];
    const targetCol = cols[1]; // In Progress
    const targetX = targetCol.x + targetCol.w / 2;
    const targetY = targetCol.y + targetCol.h / 2;

    console.log(`  Dragging "${src.text}" from (${src.x.toFixed(0)},${src.y.toFixed(0)}) to (${targetX.toFixed(0)},${targetY.toFixed(0)})`);

    // Use page.dispatchEvent for @dnd-kit compatibility
    const srcEl = page.locator('[aria-roledescription="sortable"]').first();
    
    // Dispatch pointerdown on the source
    await srcEl.dispatchEvent('pointerdown', { bubbles: true, cancelable: true });
    await page.waitForTimeout(200);
    
    // Move in small steps dispatching pointermove
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const x = src.x + (targetX - src.x) * (i / steps);
      const y = src.y + (targetY - src.y) * (i / steps);
      await page.mouse.move(x, y); // Also move the mouse for visual feedback
      await page.dispatchEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: y });
      await page.waitForTimeout(30);
    }
    
    // Dispatch pointerup
    await page.mouse.up();
    await page.dispatchEvent('pointerup', { bubbles: true, cancelable: true });
    await page.waitForTimeout(1500);

    // Check if task moved
    const tasksAfter = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[aria-roledescription="sortable"]')).map(el => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent.trim().substring(0, 40), y: rect.y, bottom: rect.y + rect.height };
      });
    });
    const colsAfter = await page.evaluate(() => {
      const headers = document.evaluate('//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const results = [];
      for (let i = 0; i < headers.snapshotLength; i++) {
        const span = headers.snapshotItem(i);
        if (!span) continue;
        let col = span;
        for (let j = 0; j < 6 && col; j++) {
          if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
          col = col.parentElement;
        }
        const rect = col ? col.getBoundingClientRect() : null;
        results.push({ name: span.textContent, y: rect.y, h: rect.height, bottom: rect.y + rect.height });
      }
      return results;
    });

    console.log('\n=== TASKS AFTER DRAG ===');
    tasksAfter.forEach(t => {
      const inCol = colsAfter.find(c => t.y >= c.y && t.y <= c.y + c.h);
      console.log(`  "${t.text}" y=${t.y} → ${inCol ? inCol.name : 'UNKNOWN'}`);
    });

    // Also try just mouse + keyboard approach
    console.log('\n=== TEST: MOUSE-DOWN THEN KEYBOARD DRAG ===');
    // Actually let me try something else: use dragstart/dragover/drop events
    // Wait, @dnd-kit uses pointer events, not HTML5 drag
    
    // Final attempt: really aggressive mouse drag with slow movement
    const p2 = await browser.newPage();
    await p2.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
    await p2.waitForTimeout(2000);
    
    const srcEl2 = p2.locator('[aria-roledescription="sortable"]').first();
    const srcBox = await srcEl2.boundingBox();
    const targetCol2 = (await p2.evaluate(() => {
      const headers = document.evaluate('//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < headers.snapshotLength; i++) {
        const span = headers.snapshotItem(i);
        if (span.textContent === 'In Progress') {
          let col = span;
          for (let j = 0; j < 6 && col; j++) {
            if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
            col = col.parentElement;
          }
          const r = col.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
      }
      return null;
    }));
    
    if (srcBox && targetCol2) {
      console.log(`  src: (${srcBox.x},${srcBox.y}), target: (${targetCol2.x},${targetCol2.y})`);
      
      await p2.mouse.move(srcBox.x + srcBox.width/2, srcBox.y + srcBox.height/2);
      await p2.waitForTimeout(500);
      await p2.mouse.down();
      await p2.waitForTimeout(500);
      
      // VERY slow drag with many steps
      for (let s = 1; s <= 50; s++) {
        const x = (srcBox.x + srcBox.width/2) + (targetCol2.x - srcBox.x - srcBox.width/2) * (s / 50);
        const y = (srcBox.y + srcBox.height/2) + (targetCol2.y - srcBox.y - srcBox.height/2) * (s / 50);
        await p2.mouse.move(x, y);
        await p2.waitForTimeout(40);
      }
      await p2.waitForTimeout(500);
      await p2.mouse.up();
      await p2.waitForTimeout(2000);
      
      const tasksAfter2 = await p2.evaluate(() => {
        return Array.from(document.querySelectorAll('[aria-roledescription="sortable"]')).map(el => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent.trim().substring(0, 40), y: r.y };
        });
      });
      const colsAfter2 = await p2.evaluate(() => {
        const headers = document.evaluate('//span[text()="Todo" or text()="In Progress" or text()="Review" or text()="Done"]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const results = [];
        for (let i = 0; i < headers.snapshotLength; i++) {
          const span = headers.snapshotItem(i);
          if (!span) continue;
          let col = span;
          for (let j = 0; j < 6 && col; j++) {
            if (col.className && col.className.includes('min-h') && col.className.includes('flex-col')) break;
            col = col.parentElement;
          }
          const r = col ? col.getBoundingClientRect() : null;
          results.push({ name: span.textContent, y: r.y, h: r.height });
        }
        return results;
      });
      
      console.log('\n=== AFTER AGGRESSIVE DRAG ===');
      tasksAfter2.forEach(t => {
        const inCol = colsAfter2.find(c => t.y >= c.y && t.y <= c.y + c.h);
        console.log(`  "${t.text}" y=${t.y} → ${inCol ? inCol.name : 'UNKNOWN'}`);
      });
    }
    
    await p2.close();
  }

  await browser.close();
})();
