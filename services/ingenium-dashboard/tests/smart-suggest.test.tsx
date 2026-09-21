import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

vi.mock("../src/lib/api", () => ({
  getApiBase: () => "/api/v1",
}));

import SmartSuggest from "../src/app/mail/components/SmartSuggest";

const suggestions = {
  data: {
    configured: true,
    source: "generated",
    suggestions: [{
      tone: "friendly",
      subject: "Re: Project update",
      body: "Thanks for the update. I will review it today.",
    }],
  },
};

describe("SmartSuggest cards", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(suggestions), { status: 200 }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fetches folder-aware suggestions and preserves collapse, copy, and apply actions", async () => {
    const onDraft = vi.fn();
    render(
      <SmartSuggest
        emailUid="email-1"
        accountId="account-1"
        folder="Sent Items"
        onDraft={onDraft}
      />,
    );

    expect(await screen.findByText("Re: Project update")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/v1/emails/suggest/email-1?project=test-project&account=account-1&folder=Sent%20Items",
    );

    const collapse = screen.getByRole("button", { name: "Smart Replies" });
    fireEvent.click(collapse);
    expect(screen.queryByText("Re: Project update")).toBeNull();
    fireEvent.click(collapse);
    expect(screen.getByText("Re: Project update")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy draft to clipboard" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Re: Project update\n\nThanks for the update. I will review it today.",
    );

    fireEvent.click(screen.getByRole("button", { name: 'Apply "friendly" draft' }));
    expect(onDraft).toHaveBeenCalledWith(suggestions.data.suggestions[0]);
  });

  it("keeps manual mode idle until the user requests suggestions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <SmartSuggest
        emailUid="email-1"
        accountId="account-1"
        folder="INBOX"
        mode="manual"
      />,
    );

    expect(screen.getByRole("button", { name: "Generate Suggestions" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate Suggestions" }));
    await waitFor(() => expect(screen.getByText("Re: Project update")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
