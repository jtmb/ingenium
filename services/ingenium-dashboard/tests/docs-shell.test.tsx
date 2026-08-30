import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dropdown, DropdownItem, DropdownPanel, DropdownTrigger } from "../src/app/components/Dropdown";
import DocsShell from "../src/app/docs/components/DocsShell";
import EditorToolbar from "../src/app/docs/components/EditorToolbar";

afterEach(cleanup);

function DrawerTreeFixture() {
  return (
    <div>
      <button type="button" aria-label="Expand children">Expand</button>
      <Dropdown>
        <DropdownTrigger aria-label="Page actions">Actions</DropdownTrigger>
        <DropdownPanel aria-label="Page actions menu">
          <DropdownItem>Rename</DropdownItem>
        </DropdownPanel>
      </Dropdown>
      <button type="button" data-page-tree-select aria-label="Select page">Page</button>
    </div>
  );
}

describe("DocsShell space selector", () => {
  it("caps the mobile selector and truncates long space names", () => {
    render(
      <DocsShell
        spaces={[{ id: 1, name: "A very long documentation space name" }]}
        selectedSpaceId={1}
        onSelectSpace={() => undefined}
        onSearch={() => undefined}
        onNewPage={() => undefined}
        tree={<div>Tree</div>}
        main={<div>Main</div>}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Select space" });
    const wrapper = select.parentElement;

    expect(wrapper?.className).toContain("w-36");
    expect(wrapper?.className).toContain("max-w-full");
    expect(wrapper?.className).toContain("min-w-0");
    expect(wrapper?.className).toContain("sm:w-48");
    expect(select.className).toContain("w-full");
    expect(select.className).toContain("min-w-0");
    expect(select.className).toContain("truncate");
  });

  it("wraps the workspace toolbar at mobile widths without dropping page actions", () => {
    render(
      <DocsShell
        spaces={[{ id: 1, name: "Docs" }]}
        selectedSpaceId={1}
        onSelectSpace={() => undefined}
        onSearch={() => undefined}
        onNewPage={() => undefined}
        topBarActions={
          <>
            <button type="button" aria-label="Create task">Create task</button>
            <button type="button" aria-label="Publish page">Publish</button>
            <button type="button" aria-label="Archive page">Archive</button>
          </>
        }
        tree={<div>Tree</div>}
        main={<div>Main</div>}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Docs workspace toolbar" });
    expect(toolbar.className).toContain("min-w-0");
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("min-h-11");
    expect(toolbar.className).toContain("h-auto");
    expect(toolbar.className).toContain("lg:flex-nowrap");
    expect(toolbar.className).toContain("lg:h-11");
    expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive page" })).toBeTruthy();
  });

  it("closes the mobile drawer only for page selection, not expanders or actions", () => {
    const { container } = render(
      <DocsShell
        spaces={[{ id: 1, name: "Docs" }]}
        selectedSpaceId={1}
        onSelectSpace={() => undefined}
        onSearch={() => undefined}
        onNewPage={() => undefined}
        tree={<DrawerTreeFixture />}
        main={<div>Main</div>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open page tree" }));
    const drawer = screen.getByRole("dialog", { name: "Page tree" });

    fireEvent.click(within(drawer).getByRole("button", { name: "Expand children" }));
    expect(screen.getByRole("dialog", { name: "Page tree" })).toBeTruthy();

    fireEvent.click(within(drawer).getByRole("button", { name: "Page actions" }));
    const menu = within(drawer).getByRole("menu", { name: "Page actions menu" });
    expect(menu.className).toContain("max-w-[calc(100vw-1rem)]");
    expect(screen.getByRole("dialog", { name: "Page tree" })).toBeTruthy();

    fireEvent.click(within(drawer).getByRole("button", { name: "Select page" }));
    expect(screen.queryByRole("dialog", { name: "Page tree" })).toBeNull();
    const retainedPanel = container.querySelector("[data-edge-drawer-panel]");
    expect(retainedPanel).not.toBeNull();
    expect(retainedPanel?.getAttribute("aria-hidden")).toBe("true");
    expect(retainedPanel?.hasAttribute("inert")).toBe(true);
    fireEvent.transitionEnd(retainedPanel!, { propertyName: "transform" });
    expect(container.querySelector("[data-edge-drawer-panel]")).toBeNull();
  });
});

describe("EditorToolbar responsive layout", () => {
  it("wraps formatting controls while keeping every control named and reachable", () => {
    render(
      <EditorToolbar
        mode="edit"
        onModeChange={() => undefined}
        onInsertMarkdown={() => undefined}
      />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Editor toolbar" });
    expect(toolbar.className).toContain("min-w-0");
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("min-h-9");
    expect(toolbar.className).toContain("h-auto");
    expect(toolbar.className).toContain("lg:flex-nowrap");
    expect(toolbar.className).toContain("lg:h-9");
    expect(toolbar.className).not.toContain("overflow-x-auto");

    for (const label of [
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bold",
      "Italic",
      "Bullet List",
      "Numbered List",
      "Task List",
      "Blockquote",
      "Code Block",
      "Link",
      "Image",
      "Table",
      "Horizontal Rule",
      "View",
      "Edit",
      "Source",
      "Split",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });
});
