import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { getOpenCodeWebUrl, getOpenCodeCliUrl, getOpenCodeAvailability } from "@/lib/runtime-urls";

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

// ── Availability ───────────────────────────────────────────────────────────

describe("getOpenCodeAvailability", () => {
  it("returns ok-loopback on localhost", () => {
    setLocation("http://localhost:3000/");
    expect(getOpenCodeAvailability()).toBe("ok-loopback");
  });

  it("returns ok-loopback on 127.0.0.1", () => {
    setLocation("http://127.0.0.1:3000/");
    expect(getOpenCodeAvailability()).toBe("ok-loopback");
  });

  it("returns ok-https-origin on HTTPS", () => {
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeAvailability()).toBe("ok-https-origin");
  });

  it("returns ok-https-origin when HTTPS override is configured on LAN HTTP", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    setLocation("http://192.168.1.50:3000/");
    expect(getOpenCodeAvailability()).toBe("ok-https-origin");
  });

  it("returns unavailable for LAN HTTP without HTTPS override", () => {
    delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
    setLocation("http://192.168.1.50:3000/");
    expect(getOpenCodeAvailability()).toBe("unavailable");
  });

  it("returns unavailable for internal HTTP hostnames without override", () => {
    setLocation("http://ingenium.internal:3000/");
    expect(getOpenCodeAvailability()).toBe("unavailable");
  });
});

// ── Runtime URL derivation ────────────────────────────────────────────────

describe("getOpenCodeWebUrl — runtime URL derivation", () => {
  it("preserves localhost and substitutes port 4098", () => {
    setLocation("http://localhost:3000/opencode");
    expect(getOpenCodeWebUrl()).toBe("http://localhost:4098/");
  });

  it("returns null for HTTPS without explicit override", () => {
    delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBeNull();
  });

  it("returns configured HTTPS origin when valid", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBe("https://opencode.example.com/");
  });

  it("returns configured HTTPS origin on loopback too", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/";
    setLocation("http://localhost:3000/");
    expect(getOpenCodeWebUrl()).toBe("https://opencode.example.com/");
  });

  it("rejects configured sub-path origin", () => {
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = "https://opencode.example.com/opencode-web/";
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeWebUrl()).toBeNull();
  });

  it("returns null for LAN HTTP without override", () => {
    setLocation("http://192.168.1.50:3000/");
    expect(getOpenCodeWebUrl()).toBeNull();
  });

  it("returns null for internal HTTP hostnames", () => {
    setLocation("http://ingenium.internal:3000/");
    expect(getOpenCodeWebUrl()).toBeNull();
  });

  it("strips the pathname, returning only origin", () => {
    setLocation("http://localhost:3000/mail/inbox");
    const url = getOpenCodeWebUrl();
    expect(url).not.toContain("/mail/inbox");
    expect(url).toBe("http://localhost:4098/");
  });

  it("returns null on non-standard remote HTTP port", () => {
    setLocation("http://devbox:8080/");
    expect(getOpenCodeWebUrl()).toBeNull();
  });
});

describe("getOpenCodeCliUrl — CLI URL derivation", () => {
  it("returns correct port 4099 on loopback", () => {
    setLocation("http://localhost:3000/");
    expect(getOpenCodeCliUrl()).toBe("http://localhost:4099/");
  });

  it("returns null for LAN HTTP", () => {
    setLocation("http://192.168.1.50:3000/");
    expect(getOpenCodeCliUrl()).toBeNull();
  });

  it("returns null for HTTPS without override", () => {
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeCliUrl()).toBeNull();
  });

  it("returns configured HTTPS CLI origin when valid", () => {
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = "https://cli.example.com/";
    setLocation("https://dashboard.example.com/");
    expect(getOpenCodeCliUrl()).toBe("https://cli.example.com/");
  });
});

// ── SSR fallback ──────────────────────────────────────────────────────────

describe("SSR fallback — window absence", () => {
  it("returns null for Web URL when window is absent", () => {
    const savedWindow = globalThis.window;
    // @ts-expect-error — deleting window to simulate SSR
    delete globalThis.window;
    try {
      expect(getOpenCodeWebUrl()).toBeNull();
      expect(getOpenCodeCliUrl()).toBeNull();
    } finally {
      globalThis.window = savedWindow;
    }
  });

  it("typeof window guard in source prevents crash during SSR", () => {
    const savedWindow = globalThis.window;
    // @ts-expect-error — deleting window to simulate SSR
    delete globalThis.window;
    try {
      // Calling the real function must not throw
      expect(() => getOpenCodeWebUrl()).not.toThrow();
      expect(getOpenCodeWebUrl()).toBeNull();
    } finally {
      globalThis.window = savedWindow;
    }
  });
});
