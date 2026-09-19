import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_SERVER_PATH = fileURLToPath(new URL("../scripts/api-server.ts", import.meta.url));

describe("coordination API retirement", () => {
  it("does not mount the retired coordination router or rate limiter", () => {
    const source = readFileSync(API_SERVER_PATH, "utf8");
    expect(source).not.toContain('"../lib/routes/coordination.js"');
    expect(source).not.toContain('"/api/v1/coordination"');
    expect(source).not.toContain("coordinationRateLimit");
  });
});
