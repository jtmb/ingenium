import { test, expect } from "@playwright/test";

/**
 * E2E tests for the Vault (Secrets) first-run flow.
 *
 * A fresh database always reports the vault as sealed + not initialized,
 * which triggers the "Create Your Vault" UI with the passphrase creation
 * modal. Tests all validation states and the successful vault creation flow.
 */
test.describe("Vault — First-Run Flow", () => {
  test("create vault with passphrase, validate errors, submit successfully", async ({ page }) => {
    /* ------------------------------------------------------------------ */
    /*  1. Navigate to /secrets (fresh DB -> uninitialized)                */
    /* ------------------------------------------------------------------ */
    await page.goto("/secrets", { waitUntil: "domcontentloaded" });

    // The CreateVaultModal is auto-opened by the page's useEffect when the
    // vault status returns sealed + not initialized. Wait for the title.
    await expect(page.getByText("Create Your Vault Passphrase")).toBeVisible({ timeout: 8000 });

    // Find the dialog wrapper — the backdrop div that contains the modal
    // Use the title text and navigate to the containing dialog element
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Create Your Vault Passphrase" });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify passphrase inputs are present
    const passphraseInput = dialog.locator("#create-vault-passphrase");
    const confirmationInput = dialog.locator("#create-vault-confirmation");
    await expect(passphraseInput).toBeVisible();
    await expect(confirmationInput).toBeVisible();

    /* ------------------------------------------------------------------ */
    /*  3. Type mismatched passphrases — verify error                      */
    /* ------------------------------------------------------------------ */
    await passphraseInput.fill("correct-horse-battery");
    await confirmationInput.fill("wrong-horse-battery");
    await expect(dialog.getByText("Passphrases do not match")).toBeVisible({ timeout: 3000 });

    /* ------------------------------------------------------------------ */
    /*  4. Type short passphrase — verify error                            */
    /* ------------------------------------------------------------------ */
    await passphraseInput.fill("short");
    await confirmationInput.fill("short");
    await expect(dialog.getByText(/At least 12 characters/)).toBeVisible({ timeout: 3000 });

    // Clear both fields
    await passphraseInput.fill("");
    await confirmationInput.fill("");

    /* ------------------------------------------------------------------ */
    /*  5. Type matching >=12 char passphrases — verify green checkmark     */
    /* ------------------------------------------------------------------ */
    await passphraseInput.fill("my-strong-vault-passphrase-2024");
    await confirmationInput.fill("my-strong-vault-passphrase-2024");

    // "Passphrases match" should appear with a green checkmark
    const matchText = dialog.getByText("Passphrases match");
    await expect(matchText).toBeVisible({ timeout: 3000 });

    /* ------------------------------------------------------------------ */
    /*  6. Try clicking "Create & Unseal Vault" without checkbox — disabled */
    /* ------------------------------------------------------------------ */
    const submitBtn = dialog.getByRole("button", { name: "Create & Unseal Vault" });
    await expect(submitBtn).toBeVisible();

    // Button should be disabled (acknowledgement checkbox not checked)
    await expect(submitBtn).toBeDisabled();

    // Verify the button has opacity-50 class indicating disabled state
    await expect(submitBtn).toHaveClass(/opacity-50/);

    /* ------------------------------------------------------------------ */
    /*  7. Check acknowledgement checkbox — button enables                */
    /* ------------------------------------------------------------------ */
    const checkbox = dialog.locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await checkbox.check();

    // The acknowledgement label text should be visible
    await expect(dialog.getByText("I understand there is no passphrase recovery")).toBeVisible();

    // The button should now be enabled
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });

    /* ------------------------------------------------------------------ */
    /*  8. Submit — verify vault unseals (3-pane layout appears)          */
    /* ------------------------------------------------------------------ */
    await submitBtn.click();

    // The modal should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The "Lock Vault" button should appear in the unsealed state
    const lockBtn = page.getByRole("button", { name: "Lock Vault" });
    await expect(lockBtn).toBeVisible({ timeout: 8000 });

    // The Secrets heading should still be present
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    // The "Items" heading should be in the center pane of the 3-pane layout
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible({ timeout: 5000 });

    // The "+ New Item" button should be visible
    const newItemBtn = page.getByRole("button", { name: "+ New Item" });
    await expect(newItemBtn).toBeVisible({ timeout: 3000 });

    // Empty vault text should be visible since no items exist yet
    await expect(page.getByText("No items in this folder.")).toBeVisible({ timeout: 3000 });
  });
});
