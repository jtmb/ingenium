import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import {
  Dropdown,
  DropdownItem,
  DropdownPanel,
  DropdownTrigger,
} from "../src/app/components/Dropdown";
import { Listbox, ListboxOption, useListboxNavigation } from "../src/app/components/Combobox";

const docsMocks = vi.hoisted(() => ({
  spaces: vi.fn(),
  tree: vi.fn(),
  tags: vi.fn(),
  allUnique: vi.fn(),
  addTag: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    docs: {
      spaces: { list: docsMocks.spaces },
      pages: { tree: docsMocks.tree },
      tags: {
        list: docsMocks.tags,
        allUnique: docsMocks.allUnique,
        add: docsMocks.addTag,
      },
    },
  },
}));

import PageTree from "../src/app/docs/components/PageTree";
import TagsManager from "../src/app/docs/components/TagsManager";

function MenuFixture() {
  return (
    <Dropdown>
      <DropdownTrigger aria-label="Open actions">Actions</DropdownTrigger>
      <DropdownPanel aria-label="Actions menu">
        <DropdownItem>Alpha</DropdownItem>
        <DropdownItem>Beta</DropdownItem>
        <DropdownItem>Gamma</DropdownItem>
      </DropdownPanel>
    </Dropdown>
  );
}

function ComboboxFixture() {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const items = ["Alpha", "Beta", "Gamma"].filter((item) => item.toLowerCase().includes(query.toLowerCase()));
  const navigation = useListboxNavigation({
    id: "fixture",
    items,
    activeIndex,
    onActiveIndexChange: setActiveIndex,
    onSelect: (index) => setSelected(items[index] ?? ""),
    onClose: () => setOpen(false),
  });

  return (
    <div>
      <input
        aria-label="Search fixture"
        value={query}
        role="combobox"
        aria-expanded={open}
        {...navigation.inputProps}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
      />
      {open && (
        <Listbox id={navigation.listboxId} aria-label="Fixture results">
          {items.map((item, index) => (
            <ListboxOption
              key={item}
              {...navigation.getOptionProps(index)}
              active={index === activeIndex}
              onClick={() => setSelected(item)}
            >
              {item}
            </ListboxOption>
          ))}
        </Listbox>
      )}
      <output aria-label="Selected fixture">{selected}</output>
    </div>
  );
}

describe("UI-102 shared controls", () => {
  beforeEach(() => {
    docsMocks.spaces.mockResolvedValue({ data: [{ id: 1, name: "Docs" }] });
    docsMocks.tree.mockResolvedValue({
      data: [{ id: 10, title: "Root page", status: "draft", children: [] }],
    });
    docsMocks.tags.mockResolvedValue({ data: [] });
    docsMocks.allUnique.mockResolvedValue({ data: [{ id: 1, name: "release" }] });
    docsMocks.addTag.mockResolvedValue({ data: { id: 2, name: "release" } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("gives menus stable trigger semantics, keyboard navigation, typeahead, dismissal, and focus restoration", async () => {
    render(<MenuFixture />);
    const trigger = screen.getByRole("button", { name: "Open actions" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Actions menu" });
    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "g" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("menu", { name: "Actions menu" })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Actions menu" })).toBeNull();
    expect(menu).not.toBe(document.body);
  });

  it("keeps editable focus in a combobox and exposes active listbox options", () => {
    render(<ComboboxFixture />);
    const input = screen.getByRole("combobox", { name: "Search fixture" });
    fireEvent.change(input, { target: { value: "a" } });

    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-controls")).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "End" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[options.length - 1]!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status", { name: "Selected fixture" }).textContent).toBe("Gamma");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("uses menu semantics for the PageTree action menu without nested buttons", async () => {
    const onRenamePage = vi.fn();
    const { container } = render(
      <PageTree
        selectedPageId={null}
        selectedSpaceId={1}
        onSelectSpace={vi.fn()}
        onSelectPage={vi.fn()}
        onNewPage={vi.fn()}
        onRenamePage={onRenamePage}
      />,
    );

    const action = await screen.findByRole("button", { name: "Page actions for Root page" });
    expect(container.querySelector("button button")).toBeNull();
    expect(container.querySelectorAll("[data-page-tree-select]")).toHaveLength(1);
    expect(container.querySelector("[data-page-tree-select]")?.tagName).toBe("BUTTON");
    fireEvent.click(action);
    expect(screen.getByRole("menu", { name: "Actions for Root page" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onRenamePage).toHaveBeenCalledWith(10, "Root page");
  });

  it("uses listbox semantics for tag autocomplete and preserves Enter-to-create", async () => {
    render(<TagsManager pageId={10} />);
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "rel" } });
    const suggestion = await screen.findByRole("option", { name: "release" });
    expect(input.getAttribute("aria-controls")).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBe(suggestion.id);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(docsMocks.addTag).toHaveBeenCalledWith(10, "release"));
  });

  it("bounds long unbroken tag suggestions while preserving accessible text and selection", async () => {
    const longTag = "release-notes-" + "x".repeat(180);
    docsMocks.allUnique.mockResolvedValue({ data: [{ id: 1, name: longTag }] });
    render(<TagsManager pageId={10} />);

    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "release-notes" } });
    const option = await screen.findByRole("option", { name: longTag });
    const listbox = screen.getByRole("listbox", { name: "Tag suggestions" });
    const label = option.querySelector("span");
    expect(listbox.className).toContain("overflow-x-hidden");
    expect(label?.className).toContain("min-w-0");
    expect(label?.className).toContain("truncate");
    expect(label?.getAttribute("title")).toBe(longTag);
    expect(option.textContent).toBe(longTag);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(docsMocks.addTag).toHaveBeenCalledWith(10, longTag));
  });
});
