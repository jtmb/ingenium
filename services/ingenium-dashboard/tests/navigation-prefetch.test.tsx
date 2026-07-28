import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    // Model Next's automatic prefetch decision at the network boundary. A
    // persistent sidebar must opt out for every rendered Link, otherwise each
    // desktop/mobile copy schedules background RSC/static requests.
    if (prefetch !== false) void fetch(`/__next_prefetch?href=${encodeURIComponent(href)}`);
    return <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>;
  },
}));

import Navigation, { NavigationProvider } from "../src/app/components/Navigation";

describe("persistent navigation prefetching", () => {
  beforeEach(() => {
    pathname.current = "/";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not issue automatic prefetch requests for persistent sidebar links", () => {
    render(
      <NavigationProvider>
        <Navigation />
      </NavigationProvider>,
    );

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(1);
    expect(links.every((link) => link.getAttribute("data-prefetch") === "false")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
