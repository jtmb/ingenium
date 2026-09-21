import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { getSetting, setSetting } = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    settings: { get: getSetting, set: setSetting },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => ({ project: "server-shared", loading: false, error: null }),
}));

vi.mock("../src/app/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

import GeneralPanel from "../src/app/components/settings/panels/GeneralPanel";

beforeEach(() => {
  getSetting.mockResolvedValue({ data: { key: "archive_retention_days", value: "7" } });
  setSetting.mockResolvedValue({ data: { key: "archive_retention_days", value: "14" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("General settings panel", () => {
  it("loads and saves archive retention through the resolved global project", async () => {
    render(<GeneralPanel />);
    const input = await screen.findByDisplayValue("7");

    fireEvent.change(input, { target: { value: "14" } });

    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(
      "archive_retention_days",
      "14",
      "server-shared",
    ));
  });

  it("shows validation feedback and does not write an out-of-range value", async () => {
    render(<GeneralPanel />);
    const input = await screen.findByDisplayValue("7");

    fireEvent.change(input, { target: { value: "400" } });

    expect(screen.getByRole("alert").textContent).toContain("1 to 365");
    expect(setSetting).not.toHaveBeenCalled();
  });
});
