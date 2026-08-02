import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dropdown, DropdownItem, DropdownPanel, DropdownTrigger } from "../src/app/components/Dropdown";
import DocsShell from "../src/app/docs/components/DocsShell";

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

  it("closes the mobile drawer only for page selection, not expanders or actions", () => {
    render(
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
  });
});
