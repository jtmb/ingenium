import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), "utf8");
const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _prefetch, ...props }: { children: React.ReactNode; href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import Navigation, { NavigationProvider, NavigationTrigger } from "../src/app/components/Navigation";

const links = [
  ["Home", "/"], ["Chat", "/chat"], ["OpenCode", "/opencode"], ["VS Code", "/vscode"], ["Mail", "/mail"], ["Tasks", "/tasks"], ["Docs", "/docs"],
  ["Skills", "/skills"], ["Agents", "/agents"], ["Observations", "/observations"], ["Personality", "/personality"], ["Context", "/context"], ["Pipeline", "/pipeline"],
  ["Jobs", "/jobs"], ["Backups", "/backups"], ["Logs", "/logs"], ["Usage", "/usage"], ["Status", "/status"],
  ["Projects", "/projects"], ["Organizations", "/organizations"], ["Plugins", "/plugins"], ["MCP Servers", "/mcp-servers"], ["Config", "/config"], ["Secrets", "/secrets"],
] as const;

function renderShell({ includeBackgroundTargets = false }: { includeBackgroundTargets?: boolean } = {}) {
  return render(
    <>
      {includeBackgroundTargets && (
        <>
          <button data-nav-background="test-topbar" data-testid="nav-background-default">Background control</button>
          <button data-nav-background="test-content" data-testid="nav-background-preserved">Preserved background control</button>
        </>
      )}
      <NavigationProvider>
        <NavigationTrigger />
        <Navigation />
      </NavigationProvider>
    </>,
  );
}

function installMatchMedia() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: false,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  } as unknown as MediaQueryList & { matches: boolean };
  vi.stubGlobal("matchMedia", vi.fn(() => media));

  return {
    setDesktop(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
  };
}

function finishMobileDrawerExit(container: HTMLElement) {
  const panel = container.querySelector("#mobile-navigation-dialog");
  expect(panel).not.toBeNull();
  fireEvent.transitionEnd(panel!, { propertyName: "transform" });
}

describe("UI-103 application shell navigation", () => {
  beforeEach(() => {
    pathname.current = "/";
    localStorage.clear();
    document.documentElement.setAttribute("data-nav-compact", "false");
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.setAttribute("data-nav-compact", "false");
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  it("keeps the trigger before the logo and renders semantic controls for each breakpoint", () => {
    const layout = read("services/ingenium-dashboard/src/app/components/DashboardShell.tsx");
    expect(layout.indexOf("<NavigationTrigger />")).toBeLessThan(layout.indexOf('<Link href="/"'));

    renderShell();

    const desktopTrigger = screen.getByLabelText("Collapse navigation");
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    expect(desktopTrigger.className).toContain("hidden md:inline-flex");
    expect(desktopTrigger.className).not.toMatch(/(?:^|\s)inline-flex(?:\s|$)/);
    expect(desktopTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(desktopTrigger.getAttribute("aria-controls")).toBe("nav-sidebar");
    expect(mobileTrigger.className).toMatch(/(?:^|\s)inline-flex(?:\s|$)/);
    expect(mobileTrigger.className).toContain("md:hidden");
    expect(mobileTrigger.getAttribute("aria-controls")).toBe("mobile-navigation-dialog");
    expect(screen.getByRole("complementary").getAttribute("id")).toBe("nav-sidebar");
    expect(layout).toContain('data-nav-background="topbar"');
    expect(layout).toContain('data-nav-background="content"');
  });

  it("uses a full 224px rail by default and persists a 56px compact rail", () => {
    pathname.current = "/tasks";
    renderShell();

    const rail = screen.getByRole("complementary");
    expect(rail.className).toContain("w-56");
    expect(screen.getByRole("link", { name: "Tasks" }).className).toContain("bg-[var(--color-surface-selected)]");

    fireEvent.click(screen.getByLabelText("Collapse navigation"));

    expect(rail.className).toContain("w-14");
    expect(document.documentElement.getAttribute("data-nav-compact")).toBe("true");
    expect(localStorage.getItem("ingenium-nav-compact")).toBe("true");
    expect(screen.getByLabelText("Expand navigation").getAttribute("aria-expanded")).toBe("false");

    for (const [label, href] of links) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("aria-label")).toBe(label);
      expect(link.getAttribute("title")).toBe(label);
    }
  });

  it("preserves group state and all link order while changing rail density", () => {
    const { container } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByRole("button", { name: "Intelligence" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByLabelText("Collapse navigation"));
    expect(screen.getByRole("button", { name: "Intelligence navigation group" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByLabelText("Expand navigation"));

    const renderedLinks = Array.from(container.querySelectorAll("#nav-sidebar a")).map((link) => link.getAttribute("href"));
    expect(renderedLinks).toEqual(links.map(([, href]) => href));
    expect(localStorage.getItem("ingenium-nav-collapsed")).toContain('"intelligence":true');
  });

  it("removes collapsed group links from accessibility and drawer trap candidates immediately", async () => {
    const { container } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    const desktopGroup = container.querySelector("#desktop-nav-group-workspace")!;
    expect(desktopGroup.getAttribute("aria-hidden")).toBe("true");
    expect(desktopGroup.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("link", { name: "Chat" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    const mobileGroup = dialog.querySelector("#mobile-nav-group-workspace")!;
    const hiddenChat = mobileGroup.querySelector<HTMLElement>("a[href='/chat']")!;
    const trapCandidates = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")).filter(
      (element) => !element.closest("[inert], [aria-hidden='true']"),
    );
    expect(mobileGroup.getAttribute("aria-hidden")).toBe("true");
    expect(mobileGroup.hasAttribute("inert")).toBe(true);
    expect(trapCandidates).not.toContain(hiddenChat);
    expect(read("services/ingenium-dashboard/src/app/components/Navigation.tsx")).toContain("getFocusableElements");
  });

  it("adopts only exact prepaint values without changing the hydration tree", () => {
    const prepaint = read("services/ingenium-dashboard/public/navigation-prepaint.js");
    const layout = read("services/ingenium-dashboard/src/app/layout.tsx");
    const navigation = read("services/ingenium-dashboard/src/app/components/Navigation.tsx");
    const styles = read("services/ingenium-dashboard/src/app/globals.css");

    expect(layout).toContain('<Script src="/navigation-prepaint.js" strategy="beforeInteractive" />');
    expect(layout).toContain('data-nav-compact="false"');
    expect(prepaint).toContain('getItem("ingenium-nav-compact") === "true"');
    expect(prepaint).toContain('data-nav-compact", "false"');
    expect(prepaint).not.toContain("innerHTML");
    expect(navigation).toContain("const [desktopCompact, setDesktopCompact] = useState(false)");
    expect(navigation).toContain("readPrepaintDesktopCompact");
    expect(styles).toContain('html[data-nav-compact="true"] .desktop-navigation');

    const executePrepaint = new Function(prepaint);
    localStorage.setItem("ingenium-nav-compact", "invalid");
    executePrepaint();
    expect(document.documentElement.getAttribute("data-nav-compact")).toBe("false");
    localStorage.setItem("ingenium-nav-compact", "true");
    executePrepaint();
    expect(document.documentElement.getAttribute("data-nav-compact")).toBe("true");
    localStorage.setItem("ingenium-nav-compact", "false");
    executePrepaint();
    expect(document.documentElement.getAttribute("data-nav-compact")).toBe("false");
  });

  it("honors reduced motion for chevron, groups, rail, and drawer transitions", () => {
    const navigation = read("services/ingenium-dashboard/src/app/components/Navigation.tsx");
    const styles = read("services/ingenium-dashboard/src/app/globals.css");

    expect(navigation).toContain("flex items-center py-2 text-sm transition-colors motion-reduce:transition-none");
    expect(navigation).toContain("transition-transform duration-200 motion-reduce:transition-none");
    expect(navigation).toContain("transition-[max-height,opacity] duration-200 ease-in-out motion-reduce:transition-none");
    expect(navigation).toContain("transition-[width] motion-reduce:transition-none");
    expect(navigation).toContain("mobile-navigation-drawer");
    expect(navigation).toContain("<EdgeDrawer");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".edge-drawer-panel");
    expect(styles).toMatch(/html\[data-nav-compact="true"\] \.desktop-navigation \.desktop-nav-item \{\s*justify-content: center;\s*gap: 0;\s*padding-inline: 0;\s*\}/);
    expect(styles).toMatch(/html\[data-nav-compact="true"\] \.desktop-navigation \.desktop-nav-group-control \{\s*justify-content: center;\s*padding-inline: 0;\s*\}/);
    expect(styles).toContain("transition-property: color, gap, padding-inline;");
    expect(styles).toContain("transition-property: color, justify-content, padding-inline;");
    expect(styles).toMatch(/\.desktop-navigation \.desktop-nav-item,[\s\S]*\.desktop-navigation \.desktop-nav-group-control,[\s\S]*transition: none;/);
  });

  it("mounts only the mobile dialog and restores focus for escape and backdrop closes", async () => {
    const { container } = renderShell();
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
    expect(screen.getByRole("complementary").className).toContain("hidden md:flex");

    fireEvent.click(mobileTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    expect(dialog.getAttribute("id")).toBe("mobile-navigation-dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("w-64");
    expect(dialog.className).toContain("max-w-[85vw]");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByLabelText("Close navigation"));
    expect(within(dialog).getByRole("link", { name: "Tasks" }).getAttribute("title")).toBeNull();

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    first?.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    last?.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: "Escape" });
    finishMobileDrawerExit(container);
    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    expect(document.activeElement).toBe(mobileTrigger);

    fireEvent.click(mobileTrigger);
    fireEvent.click(container.querySelector('[data-nav-mode="mobile"] > [aria-hidden="true"]')!);
    finishMobileDrawerExit(container);
    await waitFor(() => expect(container.querySelector("#mobile-navigation-dialog")).toBeNull());
    expect(document.activeElement).toBe(mobileTrigger);
  });

  it("closes the drawer for a same-route link, clears inert state, and restores the trigger focus", async () => {
    pathname.current = "/tasks";
    const { container } = renderShell({ includeBackgroundTargets: true });
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    const background = screen.getByTestId("nav-background-default");
    background.inert = false;

    fireEvent.click(mobileTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    expect(background.inert).toBe(true);

    fireEvent.click(within(dialog).getByRole("link", { name: "Tasks" }));
    finishMobileDrawerExit(container);

    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
      expect(background.inert).toBe(false);
    });
    expect(document.activeElement).toBe(mobileTrigger);
  });

  it("closes a changed-route link without restoring focus to the stale trigger", async () => {
    const { container, rerender } = renderShell({ includeBackgroundTargets: true });
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    const background = screen.getByTestId("nav-background-default");
    background.inert = false;

    fireEvent.click(mobileTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    fireEvent.click(within(dialog).getByRole("link", { name: "Tasks" }));
    finishMobileDrawerExit(container);

    pathname.current = "/tasks";
    rerender(
      <NavigationProvider>
        <NavigationTrigger />
        <Navigation />
      </NavigationProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
      expect(background.inert).toBe(false);
    });
    expect(document.activeElement).not.toBe(mobileTrigger);
  });

  it("contains programmatic focus and restores exact background inert and aria states", async () => {
    const { container } = renderShell({ includeBackgroundTargets: true });
    const defaultBackground = screen.getByTestId("nav-background-default");
    const preservedBackground = screen.getByTestId("nav-background-preserved");
    defaultBackground.inert = false;
    preservedBackground.inert = true;
    preservedBackground.setAttribute("aria-hidden", "false");

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    const closeButton = within(dialog).getByRole("button", { name: "Close navigation" });
    expect(defaultBackground.inert).toBe(true);
    expect(defaultBackground.getAttribute("aria-hidden")).toBe("true");
    expect(preservedBackground.inert).toBe(true);
    expect(preservedBackground.getAttribute("aria-hidden")).toBe("true");
    expect(dialog.closest("[inert]")).toBeNull();

    defaultBackground.focus();
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    fireEvent.keyDown(dialog, { key: "Escape" });
    finishMobileDrawerExit(container);
    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    expect(defaultBackground.inert).toBe(false);
    expect(defaultBackground.getAttribute("aria-hidden")).toBeNull();
    expect(preservedBackground.inert).toBe(true);
    expect(preservedBackground.getAttribute("aria-hidden")).toBe("false");
  });

  it("uses a mobile namespace and closes on a route change without stale focus restoration", async () => {
    const { container, rerender } = renderShell();
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    fireEvent.click(mobileTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Ingenium" });
    expect(dialog.querySelector("#mobile-nav-group-workspace")).not.toBeNull();
    expect(container.querySelector("#desktop-nav-group-workspace")).not.toBeNull();
    expect(container.querySelectorAll("[id]").length).toBe(new Set(Array.from(container.querySelectorAll("[id]"), (element) => element.id)).size);

    pathname.current = "/tasks";
    rerender(
      <NavigationProvider>
        <NavigationTrigger />
        <Navigation />
      </NavigationProvider>,
    );
    await waitFor(() => expect(container.querySelector("#mobile-navigation-dialog")?.getAttribute("aria-hidden")).toBe("true"));
    finishMobileDrawerExit(container);

    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
    expect(document.activeElement).not.toBe(mobileTrigger);
  });

  it("closes and cleans up when the viewport crosses to desktop without restoring mobile focus", async () => {
    const media = installMatchMedia();
    const { container } = renderShell({ includeBackgroundTargets: true });
    const mobileTrigger = screen.getByLabelText("Open navigation menu");
    const background = screen.getByTestId("nav-background-default");
    background.inert = false;
    fireEvent.click(mobileTrigger);
    await screen.findByRole("dialog", { name: "Ingenium" });
    expect(background.inert).toBe(true);

    media.setDesktop(true);
    finishMobileDrawerExit(container);
    await waitFor(() => {
      expect(container.querySelector("#mobile-navigation-dialog")).toBeNull();
      expect(document.body.style.overflow).toBe("");
      expect(background.inert).toBe(false);
    });
    expect(document.activeElement).not.toBe(mobileTrigger);

    fireEvent.click(screen.getByLabelText("Collapse navigation"));
    expect(screen.getByLabelText("Expand navigation")).toBeDefined();
  });
});
