import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  syncConfig: vi.fn(),
  setConfig: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    configs: {
      get: mocks.getConfig,
      sync: mocks.syncConfig,
      set: mocks.setConfig,
    },
  },
}));

import ConfigPage from "../src/app/config/page";

describe("ConfigPage editor labels", () => {
  beforeEach(() => {
    mocks.getConfig.mockReset().mockResolvedValue({ data: { content: "{}" } });
    mocks.syncConfig.mockReset();
    mocks.setConfig.mockReset();
    mocks.replace.mockReset();
  });

  afterEach(cleanup);

  it("keeps the project/global editor name aligned with the selected tab", async () => {
    render(<ConfigPage />);

    expect(screen.getByRole("textbox", { name: "Project config editor" })).toBeTruthy();
    expect(screen.getByText("opencode.json")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Global Config" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Global config editor" })).toBeTruthy();
    });
    expect(screen.getByText("opencode.jsonc")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Project config editor" })).toBeNull();
  });
});
