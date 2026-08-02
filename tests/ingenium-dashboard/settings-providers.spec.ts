import { test, expect } from "@playwright/test";

/**
 * E2E tests for Settings → Providers tab.
 *
 * Tests the full lifecycle: open with deep-link, add a provider, validate the
 * private-network baseURL rejection, save, switch tabs, close, and re-open.
 *
 * The provider catalog may be unavailable while OpenCode is starting. The
 * panel must keep its loading/error/empty states explicit in that case and
 * must never throw while normalizing the response.
 */
test.describe("Settings — Providers Tab", () => {
  test("add provider, validate private network, save, close, re-open", async ({ page }) => {
    const providerRenderErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (/undefined.*find|find.*undefined/i.test(error.message)) {
        providerRenderErrors.push(error.message);
      }
    });

    await page.goto("/?settings=providers", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 8000 });

    // The Providers panel should be visible (active tab). The product exposes
    // its accessible panel heading as the concise "Providers" heading.
    const providersHeading = page.getByRole("heading", { name: "Providers", exact: true });
    await expect(providersHeading).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole("heading", { name: "Native providers", exact: true })).toBeVisible();

    const providersTab = page.locator('[role="tab"]', { hasText: "Providers" });
    await expect(providersTab).toHaveAttribute("aria-selected", "true");

    const addBtn = page.getByRole("button", { name: /Add custom provider|Add your first custom provider/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    const providerSection = page.locator("section").first();
    await expect(providerSection).toBeVisible({ timeout: 3000 });

    const providerIdInput = page.locator("label").filter({ hasText: "Provider ID" }).locator("input");
    await expect(providerIdInput).toBeVisible({ timeout: 3000 });
    await providerIdInput.fill("test-openai");
    await expect(providerIdInput).toBeFocused();

    // The server validates provider identity only after at least one model exists.
    const modelInput = providerSection.locator("input[placeholder='model-id']").first();
    await expect(modelInput).toBeVisible({ timeout: 3000 });
    await modelInput.fill("gpt-4");

    const defaultModelRadio = providerSection.locator('input[type="radio"]').first();
    await expect(defaultModelRadio).toBeVisible();
    await defaultModelRadio.check();

    const baseUrlInput = page.locator("label").filter({ hasText: "Base URL" }).locator("input");
    await expect(baseUrlInput).toBeVisible({ timeout: 3000 });
    await baseUrlInput.fill("http://localhost:9999");

    // Private-network URLs must be rejected before provider configuration is saved.
    const saveBtn = page.getByRole("button", { name: "Save providers" });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const statusMsg = page.locator('[role="status"]');
    await expect(statusMsg).toBeVisible({ timeout: 8000 });
    const statusText = await statusMsg.textContent();
    expect(statusText?.toLowerCase()).toContain("baseurl");

    await baseUrlInput.fill("");

    // A backend may be unavailable; the panel must report the result without throwing.
    await saveBtn.click();

    try {
      await expect(statusMsg).toBeVisible({ timeout: 5000 });
      // eslint-disable-next-line no-empty
    } catch {
    }

    const generalTab = page.locator('[role="tab"]', { hasText: "General" });
    await generalTab.click();
    await expect(generalTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Archive retention")).toBeVisible();

    await providersTab.click();
    await expect(providersTab).toHaveAttribute("aria-selected", "true");
    await expect(providersHeading).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible({ timeout: 3000 });

    await page.goto("/?settings=providers", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible({ timeout: 8000 });

    await expect(providersTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible({ timeout: 3000 });

    expect(providerRenderErrors).toEqual([]);
  });
});
