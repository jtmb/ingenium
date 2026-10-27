import { describe, expect, it } from "vitest";
import { JobResponseVerification } from "../lib/job-response-verification.js";

const completed = JSON.stringify({ type: "text", part: { type: "text",
  text: "INGENIUM_JOB_INLINE_AGENT_ZEN", time: { start: 1, end: 2 } } }) + "\n";

describe("native Job response verification", () => {
  it("accepts an actual completed native text event across arbitrary byte boundaries", () => {
    const verifier = new JobResponseVerification();
    const bytes = Buffer.from(completed);
    for (let index = 0; index < bytes.length; index += 3) verifier.accept(bytes.subarray(index, index + 3));
    expect(verifier.finish()).toEqual({ verified: true, responseSeen: true, providerError: false, invalid: false });
    expect(verifier.finish()).not.toHaveProperty("text");
  });
  it("accepts a final completed tool-driven turn without requiring user text output", () => {
    const verifier = new JobResponseVerification();
    verifier.accept(JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }));
    expect(verifier.finish().verified).toBe(true);
  });
  it.each(["", "\n", '{"type":"step_start","part":{"type":"step-start"}}\n',
    '{"type":"text","part":{"type":"text","text":"partial","time":{"start":1}}}\n'])(
    "does not treat exit zero or incomplete output as a response (%s)", (text) => {
      const verifier = new JobResponseVerification(); verifier.accept(text);
      expect(verifier.finish().verified).toBe(false);
    },
  );
  it("fails a provider error even after text was emitted, without returning its sensitive message", () => {
    const verifier = new JobResponseVerification();
    verifier.accept(completed);
    verifier.accept(JSON.stringify({ type: "error", error: { type: "provider.quota", message: "private-canary" } }));
    const result = verifier.finish();
    expect(result).toMatchObject({ verified: false, providerError: true });
    expect(JSON.stringify(result)).not.toContain("private-canary");
  });
  it("rejects malformed or oversized event streams without retaining raw content", () => {
    for (const content of ["not native JSON", "[]", "x".repeat(JobResponseVerification.MAX_EVENT_BYTES + 1)]) {
      const verifier = new JobResponseVerification(); verifier.accept(content);
      expect(verifier.finish()).toMatchObject({ verified: false, invalid: true });
    }
  });
});
