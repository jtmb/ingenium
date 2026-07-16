import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("Jobs — Create Job Modal", () => {
  test("Create Job modal opens with form fields", async ({ page }) => {
    await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });

    // Wait for page title
    await expect(page.locator("h1")).toContainText("Jobs");

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

test.describe("Jobs — Edit from Detail View", () => {
  test("Edit from detail view opens prepopulated overlay", async ({ page }) => {
    await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Jobs");

    // Generate unique job names to avoid conflicts across test runs
    const jobName = `E2E Edit Test ${Date.now()}`;
    const updatedName = `${jobName} (edited)`;

    // --- Step 1: Create a job via the overlay ---
    await page.getByRole("button", { name: "Create Job" }).first().click();
    await expect(page.getByRole("heading", { name: "Create Job" })).toBeVisible({ timeout: 5000 });

    // Check if agents are available; skip if none
    const agentOptions = page.locator("select").first().locator("option");
    const agentCount = await agentOptions.count();
    if (agentCount <= 1) {
      test.skip(true, "No agents configured — cannot create job");
      return;
    }

    // Fill required fields
    await page.getByPlaceholder("e.g., Nightly Security Scan").fill(jobName);
    await page.locator("select").first().selectOption({ index: 1 }); // first non-placeholder agent
    await page.getByPlaceholder(/Write the prompt template/).fill("E2E test prompt {{input}}");

    // Submit the form
    await page.getByRole("button", { name: "Create Job" }).last().click();

    // Overlay should close
    await expect(page.getByRole("heading", { name: "Create Job" })).not.toBeVisible({ timeout: 10000 });

    // Wait for the new job to appear in the list
    await expect(page.getByText(jobName).first()).toBeVisible({ timeout: 10000 });

    // --- Step 2: Enter detail view by clicking the job card ---
    await page.getByText(jobName).first().click();

    // Detail view should be visible — look for the Edit button
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 5000 });

    // --- Step 3: Click Edit to open the overlay from detail view ---
    await page.getByRole("button", { name: "Edit" }).click();

    // ASSERT: Overlay appears with prepopulated title
    await expect(page.getByRole("heading", { name: `Edit Job: ${jobName}` })).toBeVisible({ timeout: 5000 });

    // ASSERT: Form fields are pre-populated with the job's data
    await expect(page.getByPlaceholder("e.g., Nightly Security Scan")).toHaveValue(jobName);
    // The prompt template textarea should contain the original prompt
    await expect(page.getByPlaceholder(/Write the prompt template/)).toContainText("E2E test prompt");

    // --- Step 4: Modify the job name ---
    await page.getByPlaceholder("e.g., Nightly Security Scan").fill(updatedName);

    // --- Step 5: Submit the edit ---
    await page.getByRole("button", { name: "Update Job" }).click();

    // ASSERT: Overlay closes after successful update
    await expect(page.getByRole("heading", { name: `Edit Job: ${jobName}` })).not.toBeVisible({ timeout: 10000 });

    // ASSERT: Detail view shows the updated job name
    // The detail view's h1 displays the job name; wait for it to reflect the update
    await expect(page.locator("h1").filter({ hasText: updatedName })).toBeVisible({ timeout: 5000 });
  });

  test("Edit overlay closes and reopens cleanly (no stale errors)", async ({ page }) => {
    await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("Jobs");

    const jobName = `E2E Reopen Test ${Date.now()}`;

    // --- Create a job first ---
    await page.getByRole("button", { name: "Create Job" }).first().click();
    await expect(page.getByRole("heading", { name: "Create Job" })).toBeVisible({ timeout: 5000 });

    const agentOptions = page.locator("select").first().locator("option");
    const agentCount = await agentOptions.count();
    if (agentCount <= 1) {
      test.skip(true, "No agents configured — cannot create job");
      return;
    }

    await page.getByPlaceholder("e.g., Nightly Security Scan").fill(jobName);
    await page.locator("select").first().selectOption({ index: 1 });
    await page.getByPlaceholder(/Write the prompt template/).fill("E2E reopen test prompt");

    await page.getByRole("button", { name: "Create Job" }).last().click();
    await expect(page.getByRole("heading", { name: "Create Job" })).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(jobName).first()).toBeVisible({ timeout: 10000 });

    // --- Enter detail view ---
    await page.getByText(jobName).first().click();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 5000 });

    // --- Open edit overlay ---
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: `Edit Job: ${jobName}` })).toBeVisible({ timeout: 5000 });

    // Close the overlay
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: `Edit Job: ${jobName}` })).not.toBeVisible({ timeout: 5000 });

    // Reopen edit overlay
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: `Edit Job: ${jobName}` })).toBeVisible({ timeout: 5000 });

    // ASSERT: No stale wandError visible (the error is only shown after a failed auto-generate)
    // The wandError text would contain "AI generation failed" or "Configure a Synthesis LLM"
    const wandError = page.getByText(/AI generation failed|Configure a Synthesis LLM/);
    await expect(wandError).toHaveCount(0);

    // ASSERT: Form is clean — name should still be prepopulated and no error banner
    await expect(page.getByPlaceholder("e.g., Nightly Security Scan")).toHaveValue(jobName);
    // The main error banner (red background div) should not be present
    const errorBanner = page.locator(".bg-\\[var\\(--color-error-bg\\)\\]");
    await expect(errorBanner).toHaveCount(0);

    // Close overlay
    await page.keyboard.press("Escape");
  });
});
