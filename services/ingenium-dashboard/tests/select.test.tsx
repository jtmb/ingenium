import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Select from "../src/app/components/Select";

afterEach(cleanup);

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(dashboardRoot, "src");
const appRoot = join(sourceRoot, "app");
const sharedSelectConsumers = {
  "app/agents/page.tsx": 3,
  "app/chat/components/ChatHeader.tsx": 8,
  "app/components/settings/SettingsOverlay.tsx": 1,
  "app/components/settings/panels/GeneralPanel.tsx": 1,
  "app/components/settings/panels/MailPanel.tsx": 2,
  "app/components/settings/panels/PipelinePanel.tsx": 8,
  "app/docs/components/DocsShell.tsx": 1,
  "app/jobs/page.tsx": 6,
  "app/mail/components/EmailComposer.tsx": 2,
  "app/mail/components/RichTextEditor.tsx": 2,
  "app/mcp-servers/components/McpServerManager.tsx": 2,
  "app/observations/page.tsx": 2,
  "app/personality/page.tsx": 1,
  "app/secrets/components/CreateItemModal.tsx": 2,
  "app/skills/page.tsx": 1,
  "app/tasks/components/BoardView.tsx": 3,
  "app/tasks/components/TaskCreateModal.tsx": 3,
  "app/tasks/components/TaskDetail.tsx": 5,
  "app/usage/components/UsageFilters.tsx": 4,
} as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function staticInventory(pattern: RegExp): Record<string, number> {
  return Object.fromEntries(
    sourceFiles(appRoot)
      .map((path) => [
        relative(sourceRoot, path).split("\\").join("/"),
        readFileSync(path, "utf8").match(pattern)?.length ?? 0,
      ] as const)
      .filter(([path, count]) => path !== "app/components/Select.tsx" && count > 0),
  );
}

function selectImportOwners(): Record<string, number> {
  return Object.fromEntries(
    Object.keys(sharedSelectConsumers).map((relativePath) => {
      const source = readFileSync(join(sourceRoot, relativePath), "utf8");
      return [relativePath, /import\s+Select\s+from\s+["'][^"']+\/Select["'];/.test(source) ? 1 : 0];
    }),
  );
}

describe("Select", () => {
  it("renders a native select with caller-owned accessible naming", () => {
    const { container } = render(
      <>
        <label htmlFor="status-select">Status</label>
        <Select id="status-select" name="status">
          <option value="open">Open</option>
        </Select>
        <Select aria-label="Priority filter">
          <option value="high">High</option>
        </Select>
      </>,
    );

    const selects = container.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    expect(selects[0]?.tagName).toBe("SELECT");
    expect(screen.getByLabelText("Status")).toBe(selects[0]);
    expect(screen.getByRole("combobox", { name: "Priority filter" })).toBe(selects[1]);
  });

  it("preserves native form props, change handling, and refs", () => {
    const onChange = vi.fn();
    const ref = { current: null as HTMLSelectElement | null };
    const view = render(
      <form>
        <Select ref={ref} id="choice" name="choice" value="second" required onChange={onChange}>
          <option value="first">First</option>
          <option value="second">Second</option>
        </Select>
      </form>,
    );

    const select = view.container.querySelector("select")!;
    expect(ref.current).toBe(select);
    expect(select.id).toBe("choice");
    expect(select.name).toBe("choice");
    expect(select.value).toBe("second");
    expect(select.required).toBe(true);

    fireEvent.change(select, { target: { value: "first" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    view.rerender(
      <form>
        <Select ref={ref} id="choice" name="choice" value="first" required onChange={onChange}>
          <option value="first">First</option>
          <option value="second">Second</option>
        </Select>
      </form>,
    );
    expect(view.container.querySelector("select")?.value).toBe("first");
    expect(new FormData(view.container.querySelector("form")!).get("choice")).toBe("first");
  });

  it("keeps disabled and multiple native behavior intact", () => {
    render(
      <>
        <Select aria-label="Disabled" disabled>
          <option>Unavailable</option>
        </Select>
        <Select aria-label="Multiple" multiple required name="multiple-choice" defaultValue={["a"]}>
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </>,
    );

    expect((screen.getByRole("combobox", { name: "Disabled" }) as HTMLSelectElement).disabled).toBe(true);
    const multiple = screen.getByRole("listbox", { name: "Multiple" }) as HTMLSelectElement;
    expect(multiple.multiple).toBe(true);
    expect(multiple.required).toBe(true);
    expect(multiple.selectedOptions[0]?.value).toBe("a");
    expect(multiple.parentElement?.querySelector("svg")).toBeNull();
  });

  it("does not intercept native keyboard events", () => {
    const onKeyDown = vi.fn();
    render(
      <Select aria-label="Keyboard" onKeyDown={onKeyDown}>
        <option>Option</option>
      </Select>,
    );

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Keyboard" }), { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("merges native and wrapper classes and exposes a decorative chevron", () => {
    const { container } = render(
      <Select aria-label="Compact" className="w-auto text-xs" wrapperClassName="w-48 compact-control">
        <option>Compact</option>
      </Select>,
    );

    const wrapper = container.firstElementChild!;
    const select = wrapper.querySelector("select")!;
    const chevron = wrapper.querySelector("svg")!;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("w-48");
    expect(wrapper.className).toContain("compact-control");
    expect(select.className).toContain("appearance-none");
    expect(select.className).toContain("rounded-md");
    expect(select.className).toContain("pr-8");
    expect(select.className).toContain("w-auto");
    expect(select.className).toContain("text-xs");
    expect(select.className).toContain("border-[var(--color-border)]");
    expect(select.className).toContain("bg-[var(--color-surface)]");
    expect(select.className).toContain("text-[var(--color-text-primary)]");
    expect(select.className).toContain("hover:bg-[var(--color-surface-hover)]");
    expect(select.className).toContain("cursor-pointer");
    expect(select.className).toContain("focus:ring-2");
    expect(select.className).toContain("focus:ring-offset-2");
    expect(select.className).toContain("focus:ring-offset-[var(--color-surface)]");
    expect(select.className).toContain("disabled:opacity-50");
    expect(select.className).toContain("disabled:cursor-not-allowed");
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(chevron.getAttribute("width")).toBe("12");
    expect(chevron.getAttribute("height")).toBe("12");
    expect(chevron.className.baseVal).toContain("pointer-events-none");
  });
});

describe("shared Select inventory", () => {
  it("contains one implementation select and exactly 57 shared Select consumers", () => {
    const implementation = readFileSync(join(appRoot, "components/Select.tsx"), "utf8");
    const rawConsumers = staticInventory(/<select(?=\s|>)/g);
    const sharedConsumers = staticInventory(/<Select(?=\s|>)/g);

    expect(implementation.match(/<select(?=\s|>)/g)).toHaveLength(1);
    expect(rawConsumers).toEqual({});
    expect(sharedConsumers).toEqual(sharedSelectConsumers);
    expect(Object.values(sharedConsumers).reduce((total, count) => total + count, 0)).toBe(57);
    expect(selectImportOwners()).toEqual(
      Object.fromEntries(Object.keys(sharedSelectConsumers).map((path) => [path, 1])),
    );
    expect(sourceFiles(appRoot).every((path) => !/(?:^|\/)(?:\.next|dist|build)(?:\/|$)/.test(path))).toBe(true);
  });
});
