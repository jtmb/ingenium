import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OpenCodeFrame from "@/app/components/OpenCodeFrame";

/**
 * Focused OpenCode boundary tests against the real iframe component.
 *
 * The health hook is ready by default so these tests cover URL validation and
 * deterministic UI states without a live OpenCode, Docker, or provider.
 */
const healthMock = vi.hoisted(() => ({
  status: "ready" as "starting" | "ready" | "unavailable",
  error: null as string | null,
  lastChecked: 1,
  retry: vi.fn(),
}));

vi.mock("@/lib/use-opencode-health", () => ({
  useOpenCodeHealth: () => healthMock,
}));

function setLocation(url: string) {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    value: {
      href: parsed.href,
      origin: parsed.origin,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      host: parsed.host,
      port: parsed.port,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  setLocation("http://localhost:3000/");
});

afterEach(() => {
  cleanup();
  healthMock.status = "ready";
  healthMock.error = null;
  healthMock.retry.mockReset();
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenCodeFrame — direct local development", () => {
  it("resolves direct loopback iframe roots after hydration", () => {
    render(<OpenCodeFrame mode="web" cliMounted={false} />);

    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe("http://localhost:4098/");
    expect(screen.queryByTitle("OpenCode Terminal")).toBeNull();
  });

  it("mounts the CLI only after activation and uses its direct local port", () => {
    render(<OpenCodeFrame mode="cli" cliMounted />);

    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe("http://localhost:4098/");
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe("http://localhost:4099/");
  });

  it("keeps inactive frames mounted without display:none", () => {
    render(<OpenCodeFrame mode="web" cliMounted />);

    const cli = screen.getByTitle("OpenCode Terminal");
    expect(cli.style.opacity).toBe("0");
    expect(cli.style.visibility).toBe("hidden");
    expect(cli.style.pointerEvents).toBe("none");
    expect(cli.style.display).not.toBe("none");
  });
});

describe("OpenCodeFrame — bounded health gating", () => {
  it.each([
    ["starting", "OpenCode is starting up…"],
    ["unavailable", "OpenCode is unavailable"],
  ] as const)("does not mount a blank iframe while health is %s", (status, message) => {
    healthMock.status = status;
    render(<OpenCodeFrame mode="web" cliMounted />);

    expect(screen.queryByTitle("OpenCode Web")).toBeNull();
    expect(screen.queryByTitle("OpenCode Terminal")).toBeNull();
    expect(screen.getByText(message)).not.toBeNull();
  });

  it("replaces a stalled active iframe with a bounded retry surface", () => {
    vi.useFakeTimers();
    render(<OpenCodeFrame mode="web" cliMounted={false} />);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(screen.queryByTitle("OpenCode Web")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(healthMock.retry).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("OpenCodeFrame — configured roots", () => {
  it("uses dedicated HTTPS roots for both modes", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://terminal.example.com/";
    setLocation("https://dashboard.example.com/opencode");

    render(<OpenCodeFrame mode="web" cliMounted />);

    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe("https://opencode.example.com/");
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe("https://terminal.example.com/");
  });

  it("uses the authenticated host gateway roots on LAN HTTP", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "http://opencode.localhost:3000/";
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "http://cli.localhost:3000/";
    setLocation("http://192.168.1.50:3000/opencode");

    render(<OpenCodeFrame mode="web" cliMounted />);

    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe("http://opencode.localhost:3000/");
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe("http://cli.localhost:3000/");
  });

  it("does not mount a frame for an untrusted HTTP host or a subpath", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "http://dashboard.example.com:3000/opencode";
    setLocation("http://192.168.1.50:3000/opencode");

    render(<OpenCodeFrame mode="web" cliMounted={false} />);

    expect(screen.getByRole("alert").textContent).toContain("OpenCode cannot be embedded on this connection");
    expect(screen.queryByTitle("OpenCode Web")).toBeNull();
  });
});

describe("OpenCodeFrame — host-boundary failure messaging", () => {
  it("explains the LAN HTTP boundary and offers direct local development", () => {
    setLocation("http://192.168.1.50:3000/opencode");
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<OpenCodeFrame mode="web" cliMounted={false} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "OpenCode serves root-relative assets and cannot be proxied under a shared origin.",
    );
    expect(alert.textContent).toContain("Configure the validated host gateway roots or a dedicated HTTPS origin");
    fireEvent.click(screen.getByRole("button", { name: "Open OpenCode in a new tab" }));
    expect(openSpy).toHaveBeenCalledWith(
      "http://localhost:4098/",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uses the CLI direct-port escape hatch when CLI is the active mode", () => {
    setLocation("http://192.168.1.50:3000/opencode");
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<OpenCodeFrame mode="cli" cliMounted />);
    fireEvent.click(screen.getByRole("button", { name: "Open OpenCode in a new tab" }));

    expect(openSpy).toHaveBeenCalledWith(
      "http://localhost:4099/",
      "_blank",
      "noopener,noreferrer",
    );
  });

});

describe("OpenCodeFrame — trusted iframe and hydration contract", () => {
  it("does not apply the stale sandbox attribute", () => {
    render(<OpenCodeFrame mode="web" cliMounted={false} />);

    const frame = screen.getByTitle("OpenCode Web");
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
  });

  it("does not render a broken proxy iframe during SSR", () => {
    const savedWindow = globalThis.window;
    // @ts-expect-error — deleting window simulates SSR.
    delete globalThis.window;
    try {
      const html = renderToStaticMarkup(
        React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }),
      );
      expect(html).toContain("Preparing OpenCode");
      expect(html).not.toContain("/opencode-web/");
      expect(html).not.toContain("/opencode-cli/");
      expect(html).not.toContain("<iframe");
    } finally {
      globalThis.window = savedWindow;
    }
  });
});
