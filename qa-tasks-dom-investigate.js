const { chromium } = require('playwright');
const path = require('path');
const CHROME_PATH = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1232/chrome-linux64/chrome');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/tasks', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Find all heading elements
  const headings = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    const results = [];
    for (const el of allElements) {
      const tag = el.tagName.toLowerCase();
      if (['h1','h2','h3','h4','h5','h6','th','div'].includes(tag) && el.children.length <= 1) {
        const text = el.textContent.trim();
        if (['TODO','TO DO','IN PROGRESS','REVIEW','DONE','BACKLOG'].includes(text)) {
          results.push({ tag: tag, text: text, class: el.className.substring(0, 80), id: el.id });
        }
      }
    }
    return results;
  });
  console.log('=== COLUMN HEADINGS ===');
  headings.forEach(h => console.log(`  ${h.tag}.${h.class} text="${h.text}" id="${h.id}"`));

  // Find how tasks are rendered
  const taskElements = await page.evaluate(() => {
    // Look for elements containing "verify add works" which we know is a task
    const all = document.querySelectorAll('*');
    const results = [];
    for (const el of all) {
      if (el.children.length <= 1 && el.textContent.includes('verify add')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 20) {
          results.push({
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim().substring(0, 60),
            class: el.className.substring(0, 100),
            hasAttrDrag: el.hasAttribute('draggable'),
            hasAttrRole: el.getAttribute('role'),
            hasAttrData: el.getAttribute('data-testid'),
            rect: `${rect.width}x${rect.height}`
          });
        }
      }
    }
    return results;
  });
  console.log('\n=== TASK ELEMENTS (containing "verify add") ===');
  taskElements.forEach(t => console.log(`  <${t.tag}> class="${t.class}" drag=${t.hasAttrDrag} role=${t.hasAttrRole} data-testid=${t.hasAttrData} size=${t.rect} text="${t.text}"`));

  // Check for drag-and-drop library usage
  const dndElements = await page.evaluate(() => {
    return {
      dndProvider: document.querySelector('[class*="drag" i], [class*="dnd" i]') ? 'found' : 'not found',
      dndAttr: document.querySelector('[data-rbd*], [data-dnd*], [aria-grabbed]') ? 'found' : 'not found',
      draggableAttr: document.querySelector('[draggable]') ? document.querySelector('[draggable]').outerHTML.substring(0, 200) : 'none',
      sortable: document.querySelector('[class*="sortable"]') ? 'found' : 'not found'
    };
  });
  console.log('\n=== DND DETECTION ===');
  console.log(JSON.stringify(dndElements, null, 2));

  // Try to find any elements that look like task cards
  const cardLike = await page.evaluate(() => {
    const cards = [];
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const text = div.textContent.trim();
      if (text.length > 5 && text.length < 100 && 
          div.children.length <= 3 &&
          !div.querySelector('h1, h2, h3, h4, h5, h6') &&
          (text.includes('✏️') || text.includes('🗑️') || text.includes('task'))) {
        const rect = div.getBoundingClientRect();
        if (rect.width > 50 && rect.width < 800 && rect.height > 20) {
          cards.push({
            tag: div.tagName,
            text: text.substring(0, 80),
            class: div.className.substring(0, 120),
            rect: `${rect.width}x${rect.height}`,
            childCount: div.children.length
          });
        }
      }
    }
    return cards.slice(0, 10);
  });
  console.log('\n=== CARD-LIKE ELEMENTS ===');
  cardLike.forEach(c => console.log(`  <${c.tag}> class="${c.class}" size=${c.rect} children=${c.childCount} "${c.text}"`));

  await browser.close();
})();
