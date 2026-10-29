import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { listPlugins, getSource } = vi.hoisted(() => ({ listPlugins: vi.fn(), getSource: vi.fn() }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "explicit-project" }));
vi.mock("../src/lib/api", () => ({ api: { plugins: { list: listPlugins, getSource } } }));
vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null,
}));
import PluginsPage from "../src/app/plugins/page";

beforeEach(() => {
  listPlugins.mockReset();
  getSource.mockReset();
});
afterEach(cleanup);

describe("Customize inherited plugin editor source failure", () => {
  it("keeps the editor closed and surfaces the first source-read failure", async () => {
    listPlugins.mockResolvedValue({ data: [{ id: "plugin", name: "registered-plugin", file_path: "plugin.ts", enabled: true }] });
    getSource.mockRejectedValue(new Error("The registered plugin source is unavailable."));
    render(<PluginsPage />);
    const edit = await screen.findByRole("button", { name: "Edit", exact: true });
    await act(async () => { fireEvent.click(edit); });
    expect(screen.queryByRole("button", { name: "Save", exact: true })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("The registered plugin source is unavailable.")).toBeVisible();
    expect(getSource).toHaveBeenCalledTimes(1);
    expect(getSource).toHaveBeenCalledWith("registered-plugin", "explicit-project");
  });

  it("allows a confirmed empty source without treating it as a failed read", async () => {
    listPlugins.mockResolvedValue({ data: [{ id: "empty", name: "empty-plugin", file_path: "empty.ts", source_content: "", enabled: true }] });
    getSource.mockResolvedValue({ data: { source: "" } });
    render(<PluginsPage />);
    const edit = await screen.findByRole("button", { name: "Edit", exact: true });
    await act(async () => { fireEvent.click(edit); });
    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    expect(screen.getAllByRole("textbox").some((element) => (element as HTMLInputElement).value === "")).toBe(true);
  });
});
