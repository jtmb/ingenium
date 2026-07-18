import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import OpenCodeFrame from "@/app/components/OpenCodeFrame";

/**
 * OpenCodeFrame iframe DOM behavior tests against the real component.
 *
 * Verifies runtime URL derivation, conditional CLI mount, sandbox/security
 * attributes, active/inactive visibility, and accessibility attributes.
 */

// ── window.location helpers (mutable for testing) ─────────────────────────

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

const DEFAULT_LOCATION = "http://localhost:3000/";

beforeEach(() => {
  setLocation(DEFAULT_LOCATION);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Iframe rendering ──────────────────────────────────────────────────────

describe("OpenCodeFrame — web iframe", () => {
  it("uses a same-origin proxy for a LAN dashboard", () => {
    setLocation("http://192.168.1.50:3000/");
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe(
      "http://192.168.1.50:3000/opencode-web/",
    );
  });

  it("renders with title 'OpenCode Web'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web")).not.toBeNull();
  });

  it("has sandbox='allow-scripts allow-same-origin'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin",
    );
  });

  it("has allow='clipboard-write'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("allow")).toBe(
      "clipboard-write",
    );
  });

  it("renders with w-full h-full border-0 classes", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    const iframe = screen.getByTitle("OpenCode Web");
    expect(iframe.className).toContain("w-full");
    expect(iframe.className).toContain("h-full");
    expect(iframe.className).toContain("border-0");
  });
});

describe("OpenCodeFrame — CLI iframe conditional mount", () => {
  it("does NOT render the CLI iframe when cliMounted is false", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.queryByTitle("OpenCode Terminal")).toBeNull();
  });

  it("renders the CLI iframe when cliMounted is true", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Terminal")).not.toBeNull();
  });

  it("renders CLI iframe with correct runtime URL on port 4099", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe(
      "http://localhost:4099/",
    );
  });

  it("renders CLI iframe with title 'OpenCode Terminal'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Terminal")).not.toBeNull();
  });

  it("uses same-origin proxy iframe URLs under HTTPS", () => {
    setLocation("https://dashboard.example.com/opencode");
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("src")).toBe("https://dashboard.example.com/opencode-web/");
    expect(screen.getByTitle("OpenCode Terminal").getAttribute("src")).toBe("https://dashboard.example.com/opencode-cli/");
  });
});

describe("OpenCodeFrame — mode visibility", () => {
  it("web iframe is visible (opacity 1, visible, auto) when mode='web'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: true }));
    const webIframe = screen.getByTitle("OpenCode Web");
    expect(webIframe.style.opacity).toBe("1");
    expect(webIframe.style.visibility).toBe("visible");
    expect(webIframe.style.pointerEvents).toBe("auto");
  });

  it("web iframe is hidden (opacity 0, hidden, none) when mode='cli'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    const webIframe = screen.getByTitle("OpenCode Web");
    expect(webIframe.style.opacity).toBe("0");
    expect(webIframe.style.visibility).toBe("hidden");
    expect(webIframe.style.pointerEvents).toBe("none");
  });

  it("CLI iframe is visible when mode='cli'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    const cliIframe = screen.getByTitle("OpenCode Terminal");
    expect(cliIframe.style.opacity).toBe("1");
    expect(cliIframe.style.visibility).toBe("visible");
    expect(cliIframe.style.pointerEvents).toBe("auto");
  });

  it("CLI iframe is hidden when mode='web'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: true }));
    const cliIframe = screen.getByTitle("OpenCode Terminal");
    expect(cliIframe.style.opacity).toBe("0");
    expect(cliIframe.style.visibility).toBe("hidden");
    expect(cliIframe.style.pointerEvents).toBe("none");
  });
});

describe("OpenCodeFrame — accessibility attributes", () => {
  it("web iframe has aria-hidden=false when mode='web'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("aria-hidden")).toBe("false");
  });

  it("web iframe has aria-hidden=true when mode='cli'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("aria-hidden")).toBe("true");
  });

  it("web iframe has tabIndex=0 when mode='web'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("tabindex")).toBe("0");
  });

  it("web iframe has tabIndex=-1 when mode='cli'", () => {
    render(React.createElement(OpenCodeFrame, { mode: "cli", cliMounted: true }));
    expect(screen.getByTitle("OpenCode Web").getAttribute("tabindex")).toBe("-1");
  });
});

describe("OpenCodeFrame — container structure", () => {
  it("renders a container div with 'absolute inset-0' class", () => {
    const { container } = render(
      React.createElement(OpenCodeFrame, { mode: "web", cliMounted: false }),
    );
    // The outermost element is the container div
    const outerDiv = container.firstElementChild;
    expect(outerDiv).not.toBeNull();
    expect(outerDiv!.className).toContain("absolute");
    expect(outerDiv!.className).toContain("inset-0");
  });
});
