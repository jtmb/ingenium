import { describe, expect, it } from "vitest";
import { SynthesisSessionIdSchema } from "../lib/routes/synthesis.js";

describe("synthesis session identifier", () => {
  it("accepts bounded opaque OpenCode session identifiers", () => {
    expect(SynthesisSessionIdSchema.safeParse("ses_safe-123").success).toBe(true);
  });

  it.each(["", "session with spaces", "session/content", "x".repeat(257)])("rejects %j", (value) => {
    expect(SynthesisSessionIdSchema.safeParse(value).success).toBe(false);
  });
});
