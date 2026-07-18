import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../src/lib/api", () => ({ getApiBase: () => "/api/v1" }));

import AccountSetup from "../src/app/mail/components/AccountSetup";

describe("AccountSetup manual credential recovery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates the existing manual account without creating a duplicate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/settings")) return new Response(JSON.stringify({ data: {} }), { status: 200 });
      return new Response(JSON.stringify({ data: { success: true, accountId: "manual-1" } }), { status: 200 });
    });
    const onComplete = vi.fn();

    render(
      <AccountSetup
        project="global-default"
        onComplete={onComplete}
        onCancel={vi.fn()}
        reconnectAccount={{
          id: "manual-1",
          email: "manual@example.com",
          provider: "custom",
          authType: "app_password",
          imapHost: "imap.example.com",
          smtpHost: "smtp.example.com",
        }}
      />,
    );

    expect(await screen.findByText("Update Email Credentials")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("App password"), { target: { value: "new-app-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Credentials" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    const updateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/credentials"));
    expect(updateCall?.[0]).toContain("/emails/accounts/manual-1/credentials");
    expect(updateCall?.[1]).toMatchObject({ method: "PATCH" });
    expect(String((updateCall?.[1] as RequestInit).body)).not.toContain("manual@example.com");
  });
});
