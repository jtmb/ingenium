import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ApiError } from "../src/lib/api";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  unseal: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      vault: {
        ...actual.api.vault,
        initialize: mocks.initialize,
        unseal: mocks.unseal,
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
    render(<UnsealModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} project="vault-ui-test" />);

    fireEvent.change(screen.getByPlaceholderText("Vault passphrase"), { target: { value: "valid vault passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "Unseal Vault" }));

    await act(async () => { await Promise.resolve(); });
    expect(mocks.unseal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Try again in 2s");

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.unseal).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Unseal Vault" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
