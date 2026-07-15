import { chromium } from "@playwright/test";

const BASE = "http://localhost:3000";
const SCREENSHOT_DIR = "/tmp/opencode";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });

  // ── LIGHT MODE ──
  const lightPage = await context.newPage();

  // Clear any theme cookie, ensure light mode
  await lightPage.goto(`${BASE}/mail`, { waitUntil: "networkidle" });
  await lightPage.evaluate(() => {
    document.cookie = "theme=light; path=/";
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
  });
  await lightPage.reload({ waitUntil: "networkidle" });

  // Wait for email list to fully render (account + inbox data loaded)
  console.log("Waiting for email list to load...");
  await lightPage.waitForTimeout(4000);

  // Click the first email row — they render as divs with onClick handlers
  // The first email should be visible in INBOX
  const emailRow = lightPage.locator('div[class*="cursor-pointer"]').first();
  await emailRow.waitFor({ state: "visible", timeout: 15000 });
  console.log("Email row visible, clicking...");
  await emailRow.click();

  // Wait for email reader to load
  await lightPage.waitForTimeout(3000);

  // Check if reply button is visible
  const replyBtn = lightPage.locator('button:has-text("Reply")');
  const replyVisible = await replyBtn.isVisible().catch(() => false);
  console.log(`Reply button visible: ${replyVisible}`);

  if (replyVisible) {
    await replyBtn.click();
    await lightPage.waitForTimeout(1500);
  }

  // Take light-mode screenshot  
  await lightPage.screenshot({
    path: `${SCREENSHOT_DIR}/mail-reply-box-light.png`,
    fullPage: false,
  });
  console.log("✅ Light mode screenshot saved to /tmp/opencode/mail-reply-box-light.png");

  // ── DARK MODE ──
  // Toggle to dark mode
  await lightPage.evaluate(() => {
    document.cookie = "theme=dark; path=/; max-age=86400";
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await lightPage.reload({ waitUntil: "networkidle" });
  await lightPage.waitForTimeout(4000);

  // Re-click an email
  const emailRowDark = lightPage.locator('div[class*="cursor-pointer"]').first();
  await emailRowDark.waitFor({ state: "visible", timeout: 15000 });
  console.log("Dark mode: email row visible, clicking...");
  await emailRowDark.click();
  await lightPage.waitForTimeout(3000);

  // Click Reply button in dark mode
  const replyBtnDark = lightPage.locator('button:has-text("Reply")');
  const replyDarkVisible = await replyBtnDark.isVisible().catch(() => false);
  console.log(`Dark mode reply button visible: ${replyDarkVisible}`);

  if (replyDarkVisible) {
    await replyBtnDark.click();
    await lightPage.waitForTimeout(1500);
  }

  // Take dark-mode screenshot
  await lightPage.screenshot({
    path: `${SCREENSHOT_DIR}/mail-reply-box-dark.png`,
    fullPage: false,
  });
  console.log("✅ Dark mode screenshot saved to /tmp/opencode/mail-reply-box-dark.png");

  await browser.close();
  console.log("\nDone — both screenshots captured.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
