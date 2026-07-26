import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { runSuitePreflight, suiteContainmentUrls } from "./ingenium-dashboard/suite-containment";
import { manualArtifactDirectory } from "./ingenium-dashboard/visual-qa-artifacts";

const BASE = suiteContainmentUrls.dashboard;
const SCREENSHOT_DIR = manualArtifactDirectory("mail-reply-box");

async function prepareTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.goto(`${BASE}/mail`, { waitUntil: "domcontentloaded" });
  await page.evaluate((selectedTheme) => {
    document.cookie = `theme=${selectedTheme}; path=/; max-age=86400`;
    localStorage.setItem("theme", selectedTheme);
    document.documentElement.classList.toggle("dark", selectedTheme === "dark");
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function openReplyBox(page: Page): Promise<void> {
  await expect(page.locator("h1").filter({ hasText: "Mail" })).toBeVisible({ timeout: 15_000 });
  const emailRows = page.locator('div[class*="cursor-pointer"]');
  await expect(emailRows.first()).toBeVisible({ timeout: 15_000 });
  await emailRows.first().click();

  const reader = page.locator('[data-testid="email-reader-content"]');
  await expect(reader).toBeVisible({ timeout: 15_000 });
  const replyButton = reader.getByRole("button", { name: "Reply" }).first();
  await expect(replyButton).toBeVisible({ timeout: 5000 });
  await replyButton.click();

  // The inline composer is the state that makes the screenshot meaningful.
  await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 10_000 });
}

async function main(): Promise<void> {
  await runSuitePreflight("manual");

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let closeError: unknown;

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    page = await context.newPage();

    await prepareTheme(page, "light");
    await openReplyBox(page);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "mail-reply-box-light.png") });

    await prepareTheme(page, "dark");
    await openReplyBox(page);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "mail-reply-box-dark.png") });

    console.log(`Screenshots saved to ${SCREENSHOT_DIR}`);
  } finally {
    // Close each owned resource independently so a page-close error cannot
    // prevent context or browser cleanup.
    if (page) {
      try {
        await page.close();
      } catch (error) {
        closeError ??= error;
      }
    }
    if (context) {
      try {
        await context.close();
      } catch (error) {
        closeError ??= error;
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        closeError ??= error;
      }
    }
    if (closeError) throw closeError;
  }
}

main().catch((error: unknown) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
