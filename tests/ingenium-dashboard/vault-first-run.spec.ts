import { test, expect } from "./fixture";

/**
 * E2E tests for the Vault (Secrets) first-run flow.
 *
 * A fresh database always reports the vault as sealed + not initialized,
 * which triggers the "Create Your Vault" UI with the passphrase creation
 * modal. Tests all validation states and the successful vault creation flow.
 */
test.describe("Vault — First-Run Flow", () => {
  test("create vault with passphrase, validate errors, submit successfully", async ({ page }) => {
    await page.goto("/secrets", { waitUntil: "domcontentloaded" });

    // The CreateVaultModal is auto-opened by the page's useEffect when the
    // vault status returns sealed + not initialized. Wait for the title.
    await expect(page.getByText("Create Your Vault Passphrase")).toBeVisible({ timeout: 8000 });

    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Create Your Vault Passphrase" });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const passphraseInput = dialog.locator("#create-vault-passphrase");
    const confirmationInput = dialog.locator("#create-vault-confirmation");
    await expect(passphraseInput).toBeVisible();
    await expect(confirmationInput).toBeVisible();

    await passphraseInput.fill("correct-horse-battery");
    await confirmationInput.fill("wrong-horse-battery");
    await expect(dialog.getByText("Passphrases do not match")).toBeVisible({ timeout: 3000 });

    await passphraseInput.fill("short");
    await confirmationInput.fill("short");
    await expect(dialog.getByText(/At least 12 characters/)).toBeVisible({ timeout: 3000 });

    await passphraseInput.fill("");
    await confirmationInput.fill("");

    await passphraseInput.fill("my-strong-vault-passphrase-2024");
    await confirmationInput.fill("my-strong-vault-passphrase-2024");

    const matchText = dialog.getByText("Passphrases match");
    await expect(matchText).toBeVisible({ timeout: 3000 });

    const submitBtn = dialog.getByRole("button", { name: "Create & Unseal Vault" });
    await expect(submitBtn).toBeVisible();

    await expect(submitBtn).toBeDisabled();

    await expect(submitBtn).toHaveClass(/opacity-50/);

    const checkbox = dialog.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await checkbox.check();

    await expect(dialog.getByText("I understand there is no passphrase recovery")).toBeVisible();

    await expect(submitBtn).toBeEnabled({ timeout: 2000 });

    await submitBtn.click();

    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    const lockBtn = page.getByRole("button", { name: "Lock Vault" });
    await expect(lockBtn).toBeVisible({ timeout: 8000 });

    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible({ timeout: 5000 });

    const newItemBtn = page.getByRole("button", { name: "+ New Item" });
    await expect(newItemBtn).toBeVisible({ timeout: 3000 });

    await expect(page.getByText("No items in this folder.")).toBeVisible({ timeout: 3000 });
  });
});
