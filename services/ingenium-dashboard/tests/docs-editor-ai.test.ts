import { describe, expect, it } from "vitest";
import { applyAIResult, type AIApplyPayload } from "../src/app/docs/components/DocsEditor";
import type { AIAction } from "../src/app/docs/components/AIActions";

function application(overrides: Partial<AIApplyPayload>): AIApplyPayload {
  return {
    action: "summarize",
    result: "AI result",
    sourceContent: "Original content",
    ...overrides,
  };
}

describe("DocsEditor AI application", () => {
  it("appends Continue output to the latest editor content", () => {
    expect(applyAIResult(
      "Latest content",
      application({ action: "continue", result: " plus continuation" }),
    )).toEqual({ content: "Latest content plus continuation", applied: true });
  });

  it("replaces only the captured Rewrite selection", () => {
    expect(applyAIResult(
      "Keep this selected text and these edits",
      application({
        action: "rewrite",
        result: "rewritten text",
        selectedText: "selected text",
        selectionRange: { start: 10, end: 23 },
      }),
    )).toEqual({ content: "Keep this rewritten text and these edits", applied: true });
  });

  it("keeps the latest content when the captured Rewrite selection is stale", () => {
    const latestContent = "Keep this changed selection and these edits";

    expect(applyAIResult(
      latestContent,
      application({
        action: "rewrite",
        result: "stale replacement",
        selectedText: "selected text",
        selectionRange: { start: 10, end: 23 },
      }),
    )).toEqual({ content: latestContent, applied: false });
  });

  it("keeps whole-content replacement when the page-wide source is current", () => {
    expect(applyAIResult(
      "Current content",
      application({ action: "summarize", sourceContent: "Current content", result: "Whole page result" }),
    )).toEqual({ content: "Whole page result", applied: true });
  });

  it.each<AIAction>([
    "outline",
    "summarize",
    "fix_grammar",
    "tone_professional",
    "tone_casual",
    "tone_technical",
  ])("keeps current edits when a %s result has a stale page snapshot", (action) => {
    const latestContent = "Current content with edits made while AI was working";

    expect(applyAIResult(
      latestContent,
      application({ action, result: "Stale whole-page result" }),
    )).toEqual({ content: latestContent, applied: false });
  });
});
