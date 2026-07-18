import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { getOpenCodeWebUrl, getOpenCodeCliUrl } from "@/lib/runtime-urls";

/**
 * Runtime URL behavior tests against the real implementation
 * from src/lib/runtime-urls.ts.
 *
 * Covers browser hostname/protocol detection via window.location
 * and SSR fallback safety (absence of window).
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

const defaultLocation = "http://localhost:3000/";

beforeEach(() => {
  setLocation(defaultLocation);
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  vi.restoreAllMocks();
});

// ── Runtime URL derivation ────────────────────────────────────────────────

describe("getOpenCodeWebUrl — runtime URL derivation", () => {
  it("preserves localhost and substitutes port 4098", () => {
    setLocation("http://localhost:3000/opencode");
    expect(getOpenCodeWebUrl()).toBe("http://localhost:4098/");
  });

  it("preserves https protocol when served over TLS", () => {
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBe("https://dashboard.example.com/opencode-web/");
  });

  it("uses the same-origin CLI proxy when served over TLS", () => {
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeCliUrl()).toBe("https://dashboard.example.com/opencode-cli/");
  });

  it("uses a configured same-origin proxy path when served over TLS", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "/internal/opencode-web/";
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBe("https://dashboard.example.com/internal/opencode-web/");
  });

  it("rejects a direct configured origin when served over TLS", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBe("https://dashboard.example.com/opencode-web/");
  });

  it("uses the same-origin proxy for LAN HTTP deployments", () => {
    setLocation("http://192.168.1.50:3000/");
    expect(getOpenCodeWebUrl()).toBe("http://192.168.1.50:3000/opencode-web/");
  });

  it("uses the same-origin proxy for internal HTTP hostnames", () => {
    setLocation("http://ingenium.internal:3000/");
    expect(getOpenCodeWebUrl()).toBe("http://ingenium.internal:3000/opencode-web/");
  });

  it("strips the pathname, returning only origin", () => {
    setLocation("http://localhost:3000/mail/inbox");
    const url = getOpenCodeWebUrl();
    expect(url).not.toContain("/mail/inbox");
    expect(url).toBe("http://localhost:4098/");
  });

  it("uses the same-origin proxy on a non-standard remote HTTP port", () => {
    setLocation("http://devbox:8080/");
    expect(getOpenCodeWebUrl()).toBe("http://devbox:8080/opencode-web/");
  });

  it("returns correct port 4099 for CLI URL", () => {
    setLocation("http://localhost:3000/");
    expect(getOpenCodeCliUrl()).toBe("http://localhost:4099/");
  });
});

// ── SSR fallback ──────────────────────────────────────────────────────────

describe("SSR fallback — window absence", () => {
  it("returns proxy paths when window is absent", () => {
    const savedWindow = globalThis.window;
    // @ts-expect-error — deleting window to simulate SSR
    delete globalThis.window;
    try {
      expect(getOpenCodeWebUrl()).toBe("/opencode-web/");
      expect(getOpenCodeCliUrl()).toBe("/opencode-cli/");
    } finally {
      globalThis.window = savedWindow;
    }
  });

  it("typeof window guard in source prevents crash during SSR", () => {
    // This verifies the guard pattern used inside runtime-urls.ts:
    // `if (typeof window !== "undefined") { ... } else { fallback }`
    const savedWindow = globalThis.window;
    // @ts-expect-error — deleting window to simulate SSR
    delete globalThis.window;
    try {
      // Calling the real function must not throw
      expect(() => getOpenCodeWebUrl()).not.toThrow();
      expect(getOpenCodeWebUrl()).toBe("/opencode-web/");
    } finally {
      globalThis.window = savedWindow;
    }
  });
});
