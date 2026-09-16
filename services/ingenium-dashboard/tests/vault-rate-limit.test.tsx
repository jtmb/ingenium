import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ApiError, EMPTY_VAULT_RESET_REASONS } from "../src/lib/api";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  unseal: vi.fn(),
  resetEligibility: vi.fn(),
  resetEmpty: vi.fn(),
  stepUp: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      auth: { ...actual.api.auth, stepUp: mocks.stepUp },
      vault: {
        ...actual.api.vault,
        initialize: mocks.initialize,
        unseal: mocks.unseal,
        emptyReset: { eligibility: mocks.resetEligibility, reset: mocks.resetEmpty },
      },
    },
  };
});

import CreateVaultModal from "../src/app/secrets/components/CreateVaultModal";
import UnsealModal from "../src/app/secrets/components/UnsealModal";

describe("vault passphrase rate-limit cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.initialize.mockReset();
    mocks.unseal.mockReset();
    mocks.resetEligibility.mockReset();
    mocks.resetEmpty.mockReset();
    mocks.stepUp.mockReset();
    mocks.resetEligibility.mockResolvedValue({
      data: { eligible: false, reason: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("disables repeated first-run initialization attempts until Retry-After expires", async () => {
    mocks.initialize.mockRejectedValue(new ApiError(429, "Too many requests", 3));
    render(<CreateVaultModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} project="vault-ui-test" />);

    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "valid vault passphrase" } });
    fireEvent.change(screen.getByLabelText("Confirm Passphrase"), { target: { value: "valid vault passphrase" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const submit = screen.getByRole("button", { name: "Create & Unseal Vault" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await act(async () => { await Promise.resolve(); });
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Try again in 3s");
    expect((screen.getByRole("button", { name: "Try again in 3s" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Create & Unseal Vault" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses Retry-After to block unseal submissions without automatically retrying", async () => {
    mocks.unseal.mockRejectedValue(new ApiError(429, "Too many requests", 2));
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={vi.fn()} project="vault-ui-test" />);

    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), { target: { value: "valid vault passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Unseal Vault" }));

    await act(async () => { await Promise.resolve(); });
    expect(mocks.unseal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Try again in 2s");

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.unseal).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Unseal Vault" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requests step-up and retries the same passphrase only after verification", async () => {
    mocks.unseal
      .mockRejectedValueOnce(new ApiError(403, "Step-up required", null, "STEP_UP_REQUIRED"))
      .mockResolvedValueOnce({ data: { unsealed: true } });
    mocks.stepUp.mockResolvedValue({ data: { verified: true } });
    const onSuccess = vi.fn();
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={onSuccess} onReset={vi.fn()} project="vault-ui-test" />);

    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), { target: { value: "valid vault passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Unseal Vault" }));
    await act(async () => { await Promise.resolve(); });

    expect(mocks.unseal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Confirm it’s you" })).toBeTruthy();
    expect(mocks.unseal).toHaveBeenLastCalledWith("valid vault passphrase", "vault-ui-test");

    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "account credential" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mocks.stepUp).toHaveBeenCalledWith("account credential");
    expect(mocks.unseal).toHaveBeenCalledTimes(2);
    expect(mocks.unseal).toHaveBeenLastCalledWith("valid vault passphrase", "vault-ui-test");
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("offers a confirmed step-up-protected reset as soon as strict metadata proves the vault is empty", async () => {
    mocks.unseal.mockRejectedValue(new ApiError(403, "Invalid passphrase", null, "VAULT_SEALED"));
    mocks.resetEligibility.mockResolvedValue({
      data: { eligible: true, reason: null },
    });
    mocks.stepUp.mockResolvedValue({ data: { verified: true } });
    mocks.resetEmpty.mockResolvedValue({ data: { reset: true, initialized: false } });
    const onReset = vi.fn();
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={onReset} project="vault-ui-test" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mocks.resetEligibility).toHaveBeenCalledWith("vault-ui-test");
    expect(mocks.unseal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Forgot passphrase / Reset empty vault" }));
    expect(screen.getByRole("dialog", { name: "Reset empty vault?" })).toBeTruthy();
    expect(mocks.resetEmpty).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm empty-vault reset" }));
    expect(screen.getByRole("dialog", { name: "Confirm it’s you" })).toBeTruthy();
    expect(mocks.resetEmpty).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "account credential" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mocks.stepUp).toHaveBeenCalledWith("account credential");
    expect(mocks.resetEmpty).toHaveBeenCalledWith("RESET EMPTY VAULT", "vault-ui-test");
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("keeps reset unavailable and explains why when strict metadata reports dependencies", async () => {
    mocks.unseal.mockRejectedValue(new ApiError(403, "Invalid passphrase", null, "VAULT_SEALED"));
    mocks.resetEligibility.mockResolvedValue({
      data: {
        eligible: false,
        reason: EMPTY_VAULT_RESET_REASONS.protectedDependencies,
      },
    });
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={vi.fn()} project="vault-ui-test" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.queryByRole("button", { name: "Forgot passphrase / Reset empty vault" })).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("blocked to prevent loss of protected provider or configuration data");
    expect(screen.getByRole("note").textContent).toContain("explicitly remove or reconfigure those dependencies first");
  });

  it("explains the fixed unsealed reason without offering reset", async () => {
    mocks.resetEligibility.mockResolvedValue({
      data: { eligible: false, reason: EMPTY_VAULT_RESET_REASONS.unsealed },
    });
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={vi.fn()} project="vault-ui-test" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("note").textContent).toContain("currently unsealed");
    expect(screen.getByRole("note").textContent).toContain("lock the Vault and check reset eligibility again");
    expect(screen.queryByRole("button", { name: "Forgot passphrase / Reset empty vault" })).toBeNull();
  });

  it("shows an actionable authorization error without offering reset", async () => {
    mocks.resetEligibility.mockRejectedValue(new ApiError(403, "Forbidden", null, "FORBIDDEN"));
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={vi.fn()} project="vault-ui-test" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("alert").textContent).toContain("authorized installation administrator session");
    expect(screen.getByRole("button", { name: "Retry eligibility check" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forgot passphrase / Reset empty vault" })).toBeNull();
  });

  it("shows loading and retries only the eligibility check after a transient failure", async () => {
    let resolveEligibility: ((value: { data: { eligible: true; reason: null } }) => void) | undefined;
    mocks.resetEligibility
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveEligibility = resolve; }));
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} onReset={vi.fn()} project="vault-ui-test" />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Retry eligibility check" }));

    expect(screen.getByRole("status").textContent).toContain("Checking empty-vault reset eligibility");
    expect(screen.queryByRole("button", { name: "Forgot passphrase / Reset empty vault" })).toBeNull();

    await act(async () => {
      resolveEligibility?.({ data: { eligible: true, reason: null } });
      await Promise.resolve();
    });

    expect(mocks.resetEligibility).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Forgot passphrase / Reset empty vault" })).toBeTruthy();
  });
});
