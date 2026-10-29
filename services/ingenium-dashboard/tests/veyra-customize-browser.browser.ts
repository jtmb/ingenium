import { test, expect } from "@playwright/test";

// Coordinator supplies an authenticated isolated project through its fixture.
const project = process.env.VEYRA_CUSTOMIZE_TEST_PROJECT;
test.skip(!project, "Requires an authenticated coordinator-owned test project.");

test("catalog search, truthful state, scopes and lifecycle navigation", async ({ page }) => {
  await page.route("**/api/v1/plugins?**", (route) => route.fulfill({ json: { data: [
    { id: "plugin-mail", name: "Mail helper", description: "Local mail integration", file_path: "mail.ts", enabled: false },
  ] } }));
  await page.route("**/api/v1/skills?**", (route) => route.fulfill({ json: { data: [
    { id: "skill-release", name: "Release checks", description: "Verify release artifacts", enabled: 1, category: "Delivery", archived_at: null },
  ] } }));
  await page.goto("/customize/plugins?project=" + encodeURIComponent(project!));
  const surface = page.getByTestId("customize-surface");
  await expect(surface.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
  await expect(surface.getByRole("button", { name: "Mail helper, Installed · disabled", exact: true })).toBeVisible();
  await surface.getByRole("button", { name: "Public", exact: true }).click();
  await expect(surface.getByRole("status")).toContainText("Public catalog is unavailable through the current service");
  await expect(surface.getByTestId("customize-catalog-row")).toHaveCount(0);
  await surface.getByRole("link", { name: "◇ Skills", exact: true }).click();
  await expect(surface.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
  await surface.getByRole("searchbox").fill("missing resource");
  await expect(surface.getByText("No matching resources.", { exact: true })).toBeVisible();
  await surface.getByRole("searchbox").fill("release");
  await expect(surface.getByRole("button", { name: "Release checks, Installed", exact: true })).toHaveCount(2);
  await expect(surface.getByRole("link", { name: "Edit, archive, restore & review proposals" })).toHaveAttribute("href", "/customize/skills/manage?project=" + encodeURIComponent(project!));
});

test("failed plugin reads expose retry without inventing installed entries", async ({ page }) => {
  await page.route("**/api/v1/plugins?**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", message: "Denied" } } }));
  await page.goto("/customize/plugins?project=" + encodeURIComponent(project!));
  const surface = page.getByTestId("customize-surface");
  await expect(surface.getByRole("alert")).toContainText("Plugins could not be loaded");
  await expect(surface.getByTestId("customize-catalog-row")).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});
test("archive unknown outcome blocks further writes until authoritative refresh", async ({ page }) => {
  let archived = false;
  let writes = 0;
  const skill = { id: "release", name: "release-checks", description: "Release checks", enabled: 1, archived_at: null };
  await page.route("**/api/v1/skills?**", (route) => route.fulfill({ json: { data: archived ? [] : [skill] } }));
  await page.route("**/api/v1/skills/archived?**", (route) => route.fulfill({ json: { data: archived ? [{ ...skill, archived_at: "2026-10-29" }] : [] } }));
  await page.route("**/api/v1/skills/release-checks/archive?**", (route) => {
    writes++;
    archived = true;
    return route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "Outcome not confirmed" } } });
  });
  await page.goto("/customize/skills/archive?project=" + encodeURIComponent(project!));
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("outcome is unknown");
  await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "Refresh authoritative lists", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});

test("System catalog reads the explicit installation mapping and keeps editor scope", async ({ page }) => {
  const installation = { id: "installation-fixture", name: "explicit-installation", is_global: true };
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { data: [
    { id: "current", name: project, is_global: false }, installation,
  ] } }));
  await page.route("**/api/v1/skills?**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("project");
    return route.fulfill({ json: { data: requested === installation.name ? [
      { id: "orchestration-fixture", project_id: installation.id, name: "phased-checkout-orchestration", description: "Approved planning workflow", enabled: 1 },
    ] : [] } });
  });
  await page.goto("/customize/skills?project=" + encodeURIComponent(project!));
  const surface = page.getByTestId("customize-surface");
  await surface.getByRole("button", { name: "System", exact: true }).click();
  const row = surface.getByRole("button", { name: "phased-checkout-orchestration, Installed", exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("link", { name: "Open editor & lifecycle controls", exact: true })).toHaveAttribute("href", "/customize/skills/manage?project=explicit-installation");
});
