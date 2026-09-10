import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), "utf8");
const globalStyles = read("services/ingenium-dashboard/src/app/globals.css");
const stylingGuide = read("services/ingenium-dashboard/STYLING-GUIDE.md");

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import Navigation, { NavigationProvider, NavigationTrigger } from "../src/app/components/Navigation";

describe("left navigation scrollbar contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("scopes the named scroll area to the desktop sidebar and only an open mobile drawer", () => {
    const { container } = render(
      <NavigationProvider>
        <NavigationTrigger />
        <Navigation />
      </NavigationProvider>,
    );

    expect(container.querySelectorAll(".nav-scroll-area")).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const desktopSidebar = container.querySelector("#nav-sidebar");
    expect(desktopSidebar?.className).toContain("nav-scroll-area");
    expect(desktopSidebar?.className).toContain("relative");
    expect(desktopSidebar?.className).toContain("overflow-y-auto");
    expect(desktopSidebar?.className).not.toContain("overflow-hidden");
    expect(desktopSidebar?.querySelector("a[href='/']")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Open navigation menu"));

    const scrollAreas = container.querySelectorAll(".nav-scroll-area");
    const mobileDrawer = container.querySelector('[role="dialog"]');
    expect(scrollAreas).toHaveLength(2);
    expect(mobileDrawer?.className).toContain("nav-scroll-area");

    for (const scrollArea of scrollAreas) {
      expect(scrollArea.className).toContain("overflow-y-auto");
      expect(scrollArea.className).not.toContain("overflow-hidden");
      expect(scrollArea.querySelector("a[href='/']")).not.toBeNull();
      expect(scrollArea.querySelector("button[type='button']")).not.toBeNull();
    }

    expect(container.querySelectorAll('nav[aria-label$="navigation"]')).toHaveLength(2);
    expect(mobileDrawer?.getAttribute("aria-modal")).toBe("true");
  });

  it("keeps the scrollbar geometry stable and idle chrome transparent", () => {
    expect(globalStyles).toContain(".nav-scroll-area {");
    expect(globalStyles).toContain("scrollbar-gutter: stable;");
    expect(globalStyles).toContain("scrollbar-width: thin;");
    expect(globalStyles).toContain("scrollbar-color: transparent transparent;");
    expect(globalStyles).toContain(".nav-scroll-area::-webkit-scrollbar {");
    expect(globalStyles).toContain("width: 8px;");
    expect(globalStyles).toContain("height: 8px;");
    expect(globalStyles).toContain(".nav-scroll-area::-webkit-scrollbar-track {");
    expect(globalStyles).toContain(".nav-scroll-area::-webkit-scrollbar-thumb {");
    expect(globalStyles).toContain("background-color: transparent;");
    expect(globalStyles).toContain("border: 2px solid transparent;");
    expect(globalStyles).toContain(".nav-scroll-area::-webkit-scrollbar-button {");
    expect(globalStyles).toContain("display: none;");

    const hoverStyles = globalStyles.slice(globalStyles.indexOf("@media (hover: hover)"));
    expect(hoverStyles).toContain(".nav-scroll-area:hover {");
    expect(hoverStyles).toContain("scrollbar-color: var(--color-nav-scrollbar-thumb) transparent;");
    expect(hoverStyles).toContain(".nav-scroll-area:hover::-webkit-scrollbar-thumb {");
    expect(hoverStyles).toContain("background-color: var(--color-nav-scrollbar-thumb);");
    expect(hoverStyles).not.toMatch(/\.nav-scroll-area:hover[^{]*\{[^}]*\b(?:width|scrollbar-width)\s*:/s);
    expect(hoverStyles).toContain("@media (hover: none)");
    expect(globalStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalStyles).toContain(".mobile-navigation-drawer");
    expect(globalStyles).not.toMatch(/\.nav-scroll-area[^\n]*transition/);
  });

  it("documents the native scrolling and hover-only styling rule", () => {
    expect(stylingGuide).toContain("### Left navigation scrollbar");
    expect(stylingGuide).toContain("Keep `overflow-y-auto` on both containers");
    expect(stylingGuide).toContain("`--color-nav-scrollbar-thumb`");
    expect(stylingGuide).toContain("Do not apply this class to main-content scroll containers");
  });
});
