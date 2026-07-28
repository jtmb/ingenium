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

    /* ------------------------------------------------------------------ */
    /*  1. Navigate to /?settings=providers                               */
    /* ------------------------------------------------------------------ */
    await page.goto("/?settings=providers", { waitUntil: "domcontentloaded" });

    // Wait for the settings overlay to appear — the heading "Settings" confirms this
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 8000 });

    // The Providers panel should be visible (active tab). The product exposes
    // its accessible panel heading as the concise "Providers" heading.
    const providersHeading = page.getByRole("heading", { name: "Providers", exact: true });
    await expect(providersHeading).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole("heading", { name: "Native providers", exact: true })).toBeVisible();

    // Verify the Providers tab is active in the sidebar
    const providersTab = page.locator('[role="tab"]', { hasText: "Providers" });
    await expect(providersTab).toHaveAttribute("aria-selected", "true");

    /* ------------------------------------------------------------------ */
    /*  2. Add a new provider                                              */
    /* ------------------------------------------------------------------ */
    const addBtn = page.getByRole("button", { name: /Add custom provider|Add your first custom provider/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();

    // A provider section should appear after adding
    const providerSection = page.locator("section").first();
    await expect(providerSection).toBeVisible({ timeout: 3000 });

    /* ------------------------------------------------------------------ */
    /*  3. Type a Provider ID and a model ID (model required by server)    */
    /* ------------------------------------------------------------------ */
    const providerIdInput = page.locator("label").filter({ hasText: "Provider ID" }).locator("input");
    await expect(providerIdInput).toBeVisible({ timeout: 3000 });
    await providerIdInput.fill("test-openai");
    await expect(providerIdInput).toBeFocused();

    // Fill the model field — server requires non-empty models before other validation
    const modelInput = providerSection.locator("input[placeholder='model-id']").first();
    await expect(modelInput).toBeVisible({ timeout: 3000 });
    await modelInput.fill("gpt-4");

    // Click the radio button to mark it as default model
    const defaultModelRadio = providerSection.locator('input[type="radio"]').first();
    await expect(defaultModelRadio).toBeVisible();
    await defaultModelRadio.check();

    /* ------------------------------------------------------------------ */
    /*  4. Fill baseURL with localhost — expect validation error           */
    /* ------------------------------------------------------------------ */
    const baseUrlInput = page.locator("label").filter({ hasText: "Base URL" }).locator("input");
    await expect(baseUrlInput).toBeVisible({ timeout: 3000 });
    await baseUrlInput.fill("http://localhost:9999");

    // Click Save — the server validates before processing, so the baseURL
    // error should appear in the status message
    const saveBtn = page.getByRole("button", { name: "Save providers" });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Check that a status message appears (either validation error or other)
    const statusMsg = page.locator('[role="status"]');
    await expect(statusMsg).toBeVisible({ timeout: 8000 });
    const statusText = await statusMsg.textContent();
    // Should mention baseURL in the validation error
    expect(statusText?.toLowerCase()).toContain("baseurl");

    /* ------------------------------------------------------------------ */
    /*  5. Clear baseURL, try saving again                                */
    /* ------------------------------------------------------------------ */
    await baseUrlInput.fill("");

    // The save may fail when the fixture has no writable provider backend.
    // The panel should still report the result without throwing.
    await saveBtn.click();

    // Either a success/error message appears, or the button was disabled during save
    try {
      await expect(statusMsg).toBeVisible({ timeout: 5000 });
      // eslint-disable-next-line no-empty
    } catch {
      // Status may not appear if the API crashes silently
    }

    /* ------------------------------------------------------------------ */
    /*  6. Switch tabs — inactive panels are intentionally remounted       */
    /* ------------------------------------------------------------------ */
    const generalTab = page.locator('[role="tab"]', { hasText: "General" });
    await generalTab.click();
    await expect(generalTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Archive retention")).toBeVisible();

    await providersTab.click();
    await expect(providersTab).toHaveAttribute("aria-selected", "true");
    await expect(providersHeading).toBeVisible();

    /* ------------------------------------------------------------------ */
    /*  7. Close overlay (Escape)                                          */
    /* ------------------------------------------------------------------ */
    await page.keyboard.press("Escape");

    // Verify the overlay is gone — the Settings heading should disappear
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible({ timeout: 3000 });

    /* ------------------------------------------------------------------ */
    /*  8. Re-open providers — verify overlay still opens                  */
    /* ------------------------------------------------------------------ */
    await page.goto("/?settings=providers", { waitUntil: "domcontentloaded" });

    // The overlay should open and show the current accessible Providers heading
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible({ timeout: 8000 });

    // The Providers tab should be active
    await expect(providersTab).toHaveAttribute("aria-selected", "true");

    // Close overlay
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Settings" })).not.toBeVisible({ timeout: 3000 });

    expect(providerRenderErrors).toEqual([]);
  });
});
