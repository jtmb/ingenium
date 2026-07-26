import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getOpenCodeAvailability,
  getOpenCodeCliUrl,
  getOpenCodeWebUrl,
  OPENCODE_CLI_GATEWAY_URL,
  OPENCODE_WEB_GATEWAY_URL,
} from "@/lib/runtime-urls";

const initialNodeEnv = process.env.NODE_ENV;

function setLocation(url: string): void {
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
  setLocation("http://localhost:3000/opencode");
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_OPENCODE_WEB_URL;
  delete process.env.NEXT_PUBLIC_OPENCODE_CLI_URL;
  if (initialNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = initialNodeEnv;
});

describe("Phase 2C — authenticated gateway runtime roots", () => {
  it("uses authenticated gateway roots for a loopback production build", () => {
    process.env.NODE_ENV = "production";

    expect(getOpenCodeWebUrl()).toBe(OPENCODE_WEB_GATEWAY_URL);
    expect(getOpenCodeCliUrl()).toBe(OPENCODE_CLI_GATEWAY_URL);
    expect(getOpenCodeWebUrl()).not.toContain(":4098");
    expect(getOpenCodeCliUrl()).not.toContain(":4099");
    expect(getOpenCodeAvailability("web")).toBe("ok-host-gateway");
    expect(getOpenCodeAvailability("cli")).toBe("ok-host-gateway");
  });

  it("uses both authenticated host gateways on loopback instead of direct ports", () => {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_OPENCODE_WEB_URL = OPENCODE_WEB_GATEWAY_URL;
    process.env.NEXT_PUBLIC_OPENCODE_CLI_URL = OPENCODE_CLI_GATEWAY_URL;

    expect(getOpenCodeWebUrl()).toBe(OPENCODE_WEB_GATEWAY_URL);
    expect(getOpenCodeCliUrl()).toBe(OPENCODE_CLI_GATEWAY_URL);
    expect(getOpenCodeWebUrl()).not.toContain(":4098");
    expect(getOpenCodeCliUrl()).not.toContain(":4099");
    expect(getOpenCodeAvailability("web")).toBe("ok-host-gateway");
    expect(getOpenCodeAvailability("cli")).toBe("ok-host-gateway");
  });

  it("does not fall back to direct ports when the dashboard is an HTTPS origin", () => {
    setLocation("https://dashboard.example.test/opencode");

    expect(getOpenCodeWebUrl()).toBeNull();
    expect(getOpenCodeCliUrl()).toBeNull();
    expect(getOpenCodeAvailability("web")).toBe("unavailable");
    expect(getOpenCodeAvailability("cli")).toBe("unavailable");
  });
});
