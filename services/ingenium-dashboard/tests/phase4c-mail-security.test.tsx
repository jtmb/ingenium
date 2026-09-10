import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { getSetting, setSetting, listProjects, selectedProject } = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  listProjects: vi.fn(),
  selectedProject: { value: "global-default" },
}));

vi.mock("../src/lib/api", () => ({
  api: {
    projects: { list: listProjects },
    settings: {
      get: getSetting,
      set: setSetting,
    },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => selectedProject.value,
  resolveGlobalProjectName: (projects: Array<{ name: string; is_global?: boolean; archived_at?: string }>) =>
    projects.find((candidate) => Boolean(candidate.is_global) && !candidate.archived_at)?.name ?? null,
}));

import MailPanel from "../src/app/components/settings/panels/MailPanel";

const RAW_SECRET_CANARY = "raw-secret-must-not-render";
const REPLACEMENT_SECRET = "replacement-secret-from-user";

function ordinarySetting(key: string, value = ""): { data: { key: string; value: string } } {
  return { data: { key, value } };
}

function secretSetting(key: string, isSet = true, masked = isSet): { data: { key: string; isSet: boolean; masked: boolean } } {
  return { data: { key, isSet, masked } };
}

beforeEach(() => {
  selectedProject.value = "global-default";
  listProjects.mockResolvedValue({
    data: [
      { name: "global-default", is_global: true },
      { name: "external-worktree", is_global: false },
    ],
  });
  getSetting.mockImplementation((key: string) => {
    if (key === "oauth_gmail_client_secret" || key === "oauth_outlook_client_secret") {
      return Promise.resolve(secretSetting(key));
    }
    return Promise.resolve(ordinarySetting(key));
  });
  setSetting.mockImplementation((key: string, valueOrOperation: unknown) => {
    if (key === "oauth_gmail_client_secret" || key === "oauth_outlook_client_secret") {
      const operation = valueOrOperation as { action?: string };
      return Promise.resolve(secretSetting(key, operation.action !== "clear", operation.action !== "clear"));
    }
    return Promise.resolve(ordinarySetting(key));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("dashboard OAuth secret handling", () => {
  it("uses masked/isSet metadata and never renders a raw response value", async () => {
    getSetting.mockImplementation((key: string) => {
      if (key === "oauth_gmail_client_secret") {
        return Promise.resolve({
          data: { key, value: RAW_SECRET_CANARY, isSet: true, masked: true },
        });
      }
      if (key === "oauth_outlook_client_secret") return Promise.resolve(secretSetting(key));
      return Promise.resolve(ordinarySetting(key));
    });

    render(<MailPanel />);

    expect(await screen.findAllByText("Configured (masked)")).toHaveLength(2);
    expect(screen.queryByDisplayValue(RAW_SECRET_CANARY)).toBeNull();
    expect(screen.queryByText(RAW_SECRET_CANARY)).toBeNull();
    expect(screen.getAllByPlaceholderText("Saved secret — leave blank to preserve")).toHaveLength(2);
  });

  it("preserves both saved secrets when the user saves without editing them", async () => {
    render(<MailPanel />);
    const save = await screen.findByRole("button", { name: "Save OAuth Credentials" });
    fireEvent.click(save);

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(
      "oauth_gmail_client_secret",
      { action: "preserve" },
      "global-default",
    ));
    expect(setSetting).toHaveBeenCalledWith(
      "oauth_outlook_client_secret",
      { action: "preserve" },
      "global-default",
    );
    expect(JSON.stringify(setSetting.mock.calls)).not.toContain("value\":\"\"");
  });

  it("uses replace only when the user supplies a new non-empty secret", async () => {
    render(<MailPanel />);
    const input = (await screen.findAllByPlaceholderText("Saved secret — leave blank to preserve"))[0]!;
    fireEvent.change(input, { target: { value: REPLACEMENT_SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "Save OAuth Credentials" }));

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(
      "oauth_gmail_client_secret",
      { action: "replace", value: REPLACEMENT_SECRET },
      "global-default",
    ));
  });

  it("clears a saved secret only after a confirmed Clear action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MailPanel />);
    const clear = (await screen.findAllByRole("button", { name: "Clear" }))[0]!;
    fireEvent.click(clear);

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(
      "oauth_gmail_client_secret",
      { action: "clear" },
      "global-default",
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Clear the saved Gmail client secret"));
    expect(await screen.findByText("Not configured")).toBeTruthy();
  });

  it("does not clear anything when the user declines confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MailPanel />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Clear" }))[0]!);

    await waitFor(() => expect(screen.getAllByText("Configured (masked)")).toHaveLength(2));
    expect(setSetting.mock.calls.some(([, operation]) => (
      typeof operation === "object" && operation !== null && (operation as { action?: string }).action === "clear"
    ))).toBe(false);
  });

  it("saves OAuth IDs and secret operations to the server's global project when another project is selected", async () => {
    selectedProject.value = "external-worktree";
    render(<MailPanel />);
    expect((await screen.findByTestId("oauth-project-notice")).textContent).toContain(
      "Saving to global project: global-default (selected project: external-worktree)",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save OAuth Credentials" }));

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(
      "oauth_gmail_client_secret",
      { action: "preserve" },
      "global-default",
    ));
    expect(setSetting.mock.calls.every(([, , project]) => project === "global-default")).toBe(true);
    expect(setSetting.mock.calls.some(([, , project]) => project === "external-worktree")).toBe(false);
    expect(await screen.findByText(/saved in global project “global-default”/)).toBeTruthy();
  });

  it("stacks credential rows and preserves accessible labels on narrow screens", async () => {
    render(<MailPanel />);

    const gmailId = await screen.findByLabelText("Gmail Client ID");
    const gmailSecret = screen.getByLabelText("Gmail Client Secret");
    expect(gmailId.className).toContain("w-full");
    expect(gmailId.className).toContain("sm:w-64");
    expect(gmailSecret.className).toContain("min-w-0");
    expect(gmailSecret.className).toContain("w-full");
    expect(gmailSecret.parentElement?.className).toContain("flex-wrap");
    expect(gmailId.closest("div.border-t")?.className).toContain("flex-col");
    expect(gmailId.closest("div.border-t")?.className).toContain("sm:flex-row");
    expect(screen.getByLabelText("Outlook Client ID")).toBeTruthy();
    expect(screen.getByLabelText("Outlook Client Secret")).toBeTruthy();
  });

  it("gives every Mail settings control an accessible name", async () => {
    const { container } = render(<MailPanel />);

    await screen.findByRole("button", { name: "Save OAuth Credentials" });

    const namedControls = [
      ...screen.getAllByRole("button", { name: /.+/ }),
      ...screen.getAllByRole("textbox", { name: /.+/ }),
      ...screen.getAllByRole("spinbutton", { name: /.+/ }),
      ...screen.getAllByRole("combobox", { name: /.+/ }),
      ...screen.getAllByRole("checkbox", { name: /.+/ }),
      screen.getByLabelText("Gmail Client Secret"),
      screen.getByLabelText("Outlook Client Secret"),
    ];

    expect(container.querySelectorAll("button, input, select, textarea")).toHaveLength(15);
    expect(namedControls).toHaveLength(15);

    expect(screen.getByRole("spinbutton", { name: "Offline window" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Body window" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Enable Smart Replies" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Precompute replies" })).toBeTruthy();
  });
});
