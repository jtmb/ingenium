import { describe, expect, it } from "vitest";
import { brokerExecute } from "../../lib/opencode-client.js";

describe("brokerExecute — live OpenCode integration", () => {
  it("creates a session, sends a prompt, extracts text, and deletes the session", async () => {
    if (process.env.RUN_OPENCODE_LIVE !== "1" || !process.env.OPENCODE_SERVER_PASSWORD) {
      throw new Error("Live OpenCode tests require RUN_OPENCODE_LIVE=1 and OPENCODE_SERVER_PASSWORD");
    }

    const result = await brokerExecute({
      providerID: "opencode",
      modelID: "big-pickle",
      system: "You are a precise assistant. Output only what is requested.",
      user: "Print exactly: HELLO_WORLD",
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(true);
    expect(result.content.trim()).toBe("HELLO_WORLD");
  }, 35_000);
});
