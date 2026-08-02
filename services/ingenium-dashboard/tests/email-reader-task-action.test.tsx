import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("../src/lib/api", () => ({ getApiBase: () => "/api/v1" }));
vi.mock("../src/app/mail/components/EmailComposer", () => ({ default: () => null }));

import EmailReader from "../src/app/mail/components/EmailReader";
import EmailList from "../src/app/mail/components/EmailList";

const email = {
  uid: 42,
  folder: "Archive/2026",
  subject: "Follow-up",
  from: [{ name: "Sender", address: "sender@example.com" }],
  body: { text: "Message body" },
  flags: ["\\Seen"],
};

function renderReader(overrides: Record<string, unknown> = {}) {
  return render(
    <EmailReader
      email={email}
      loading={false}
      downloading={false}
      downloadError={null}
      onForward={vi.fn()}
      onDelete={vi.fn()}
      onArchive={vi.fn()}
      onCreateTask={vi.fn()}
      selectedAccount="account-1"
      {...overrides}
    />,
  );
}

afterEach(() => cleanup());

describe("EmailReader task action", () => {
  it("exposes an accessible Create task action only for a fully loaded email identity", () => {
    renderReader({ loading: true });
    expect(screen.queryByRole("button", { name: "Create task", exact: true })).toBeNull();
    expect(screen.getByTestId("email-reader-loading").className).toContain("min-w-0 md:min-w-[400px]");

    cleanup();
    renderReader({ downloading: true });
    expect(screen.queryByRole("button", { name: "Create task", exact: true })).toBeNull();
    expect(screen.getByTestId("email-reader-downloading").className).toContain("min-w-0 md:min-w-[400px]");

    cleanup();
    renderReader({ downloadError: "Could not load this email" });
    expect(screen.queryByRole("button", { name: "Create task", exact: true })).toBeNull();
    expect(screen.getByTestId("email-reader-error").className).toContain("min-w-0 md:min-w-[400px]");

    cleanup();
    renderReader({ email: null });
    expect(screen.getByTestId("email-reader-empty").className).toContain("min-w-0 md:min-w-[400px]");

    cleanup();
    renderReader({ email: { ...email, folder: undefined } });
    expect(screen.queryByRole("button", { name: "Create task", exact: true })).toBeNull();

    cleanup();
    const onCreateTask = vi.fn();
    renderReader({ onCreateTask });
    const button = screen.getByRole("button", { name: "Create task", exact: true });
    expect(button).toBeTruthy();
    expect(screen.getByTestId("email-reader-content").className).toContain("min-w-0 md:min-w-[400px]");
    expect(screen.getByTestId("email-reader-actions").className).toContain("flex-wrap");
    fireEvent.click(button);
    expect(onCreateTask).toHaveBeenCalledTimes(1);
  });

  it("uses a responsive list width variable without an inline fixed width", () => {
    render(
      <EmailList
        emails={[]}
        selectedUid={undefined}
        onSelect={vi.fn()}
        onPageChange={vi.fn()}
        total={0}
        page={1}
        loading={false}
        onSearch={vi.fn()}
        width={365}
      />,
    );

    const list = screen.getByTestId("email-list");
    expect(list.className).toContain("w-full");
    expect(list.className).toContain("md:w-[var(--mail-list-width)]");
    expect(list.style.getPropertyValue("--mail-list-width")).toBe("365px");
    expect(list.style.width).toBe("");
  });
});
