import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../src/lib/api", () => ({
  getApiBase: () => "/api/v1",
  dashboardFetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
}));

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
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    const updateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/credentials"));
    expect(updateCall?.[0]).toContain("/emails/accounts/manual-1/credentials");
    expect(updateCall?.[1]).toMatchObject({ method: "PATCH" });
    expect(String((updateCall?.[1] as RequestInit).body)).not.toContain("manual@example.com");
  });

  it("keeps a failed initial connection saved for retry, edit, or removal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/settings")) return new Response(JSON.stringify({ data: {} }), { status: 200 });
      if (url.includes("/emails/accounts?project=") && method === "POST") {
        return new Response(JSON.stringify({ data: { id: "saved-1" } }), { status: 201 });
      }
      if (url.includes("/emails/accounts/saved-1/test")) {
        return new Response(JSON.stringify({ data: { success: false, error: "Unable to connect" } }), { status: 200 });
      }
      if (url.includes("/emails/accounts/saved-1/credentials")) {
        return new Response(JSON.stringify({ data: { success: true } }), { status: 200 });
      }
      if (url.includes("/emails/accounts/saved-1?project=") && method === "PATCH") {
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      if (url.includes("/emails/accounts/saved-1?project=") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    const onComplete = vi.fn();

    render(
      <AccountSetup
        project="global-default"
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "saved@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("App password"), { target: { value: "saved-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));

    expect(await screen.findByText("The account was saved. Edit the connection settings, then retry or remove it.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Unable to connect");
    expect(fetchMock.mock.calls.some(([url, request]) =>
      String(url).includes("/emails/accounts/saved-1?project=")
      && (request as RequestInit | undefined)?.method === "DELETE",
    )).toBe(false);

    fireEvent.change(screen.getByPlaceholderText("App password"), { target: { value: "replacement-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry Connection" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) =>
      String(url).includes("/emails/accounts/saved-1/credentials")
      && (request as RequestInit | undefined)?.method === "PATCH",
    )).toBe(true));
    expect(fetchMock.mock.calls.filter(([url, request]) =>
      String(url).includes("/emails/accounts?project=")
      && (request as RequestInit | undefined)?.method === "POST",
    )).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove Saved Account" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) =>
      String(url).includes("/emails/accounts/saved-1?project=")
      && (request as RequestInit | undefined)?.method === "DELETE",
    )).toBe(true));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
