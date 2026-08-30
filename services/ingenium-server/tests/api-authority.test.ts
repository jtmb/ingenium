import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };

async function loadConfig(apiUrl: string, trusted = false, audience = "mcp") {
  process.env.INGENIUM_API_URL = apiUrl;
  process.env.INGENIUM_MCP_AUDIENCE = audience;
  if (trusted) process.env.INGENIUM_API_URL_TRUSTED = "1";
  else delete process.env.INGENIUM_API_URL_TRUSTED;
  vi.resetModules();
  return import("../config/index.js");
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.resetModules();
});

describe("MCP API authority", () => {
  it("accepts the canonical loopback API without a launcher marker", async () => {
    await expect(loadConfig("http://localhost:4097/api/v1")).resolves.toMatchObject({
      config: { apiUrl: "http://localhost:4097/api/v1" },
    });
  });

  it("accepts launcher-attested remote HTTPS", async () => {
    await expect(loadConfig("https://api.example/api/v1", true)).resolves.toMatchObject({
      config: { apiUrl: "https://api.example/api/v1" },
    });
  });

  it("accepts a launcher-attested loopback fixture on an isolated port", async () => {
    await expect(loadConfig("http://127.0.0.1:49123/api/v1", true, "repository-sync")).resolves.toMatchObject({
      config: { apiUrl: "http://127.0.0.1:49123/api/v1" },
    });
  });

  it("rejects remote authority without the launcher marker", async () => {
    await expect(loadConfig("https://api.example/api/v1")).rejects.toThrow("Ingenium API URL is not trusted");
  });

  it("allows marked non-loopback HTTP only for an isolated runtime", async () => {
    await expect(loadConfig("http://runtime-gateway:4100/api/v1", true)).rejects.toThrow("Ingenium API URL is not trusted");
    await expect(loadConfig("http://runtime-gateway:4100/api/v1", true, "runtime")).resolves.toMatchObject({
      config: { apiUrl: "http://runtime-gateway:4100/api/v1" },
    });
  });
});
