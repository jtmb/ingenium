import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("Jobs — Create Job Modal", () => {
  test("Create Job modal opens with form fields", async ({ page }) => {
    await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });

    // Wait for page title
    await expect(page.getByText("Jobs")).toBeVisible({ timeout: 10000 });

    // Click Create Job button
    const createBtn = page.getByRole("button", { name: "Create Job" }).first();
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();

    // Modal should be visible
    await expect(page.getByRole("heading", { name: "Create Job" })).toBeVisible({ timeout: 5000 });

    // Form fields should be visible
    await expect(page.getByPlaceholder("e.g., Nightly Security Scan")).toBeVisible();
    await expect(page.getByPlaceholder(/Write the prompt template/)).toBeVisible();

    // Close modal
    await page.keyboard.press("Escape");
  });
});
