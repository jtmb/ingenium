import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const apiMocks = vi.hoisted(() => ({
  taskSearch: vi.fn(),
  docsSearch: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    tasks: { search: apiMocks.taskSearch },
    docs: { search: apiMocks.docsSearch },
  },
}));

import SpotlightSearch from "../src/app/tasks/components/SpotlightSearch";
import SearchDialog from "../src/app/docs/components/SearchDialog";

beforeEach(() => {
  apiMocks.taskSearch.mockResolvedValue({ data: [{ id: "task-1", title: "Fix menu focus", column_id: "todo" }] });
  apiMocks.docsSearch.mockResolvedValue({ data: [{ id: 7, spaceId: 3, title: "Menu guide", content: "Keyboard menu guide" }] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UI-102 search controls", () => {
  it("keeps Spotlight search as a dialog with combobox/listbox navigation and focus restoration", async () => {
    const onTaskSelect = vi.fn();
    render(<SpotlightSearch project="project-1" onTaskSelect={onTaskSelect} />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Search tasks" });
    const input = screen.getByRole("combobox", { name: "Search tasks" });
    expect(dialog.contains(input)).toBe(true);
    fireEvent.change(input, { target: { value: "menu" } });
    const option = await screen.findByRole("option", { name: /Fix menu focus/ });
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTaskSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }));
    expect(screen.queryByRole("dialog", { name: "Search tasks" })).toBeNull();
  });

  it("retains Docs SearchDialog focus and selects a result through shared list navigation", async () => {
    const onClose = vi.fn();
    const onSelectPage = vi.fn();
    render(<SearchDialog isOpen onClose={onClose} onSelectPage={onSelectPage} />);

    const dialog = await screen.findByRole("dialog", { name: "Search pages" });
    const input = screen.getByRole("combobox", { name: "Search pages" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.change(input, { target: { value: "menu" } });
    await screen.findByRole("option", { name: /Menu guide/ });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSelectPage).toHaveBeenCalledWith(7, 3));
    expect(onClose).toHaveBeenCalled();
  });
});
