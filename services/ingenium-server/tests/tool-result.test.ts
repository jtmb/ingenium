import { describe, expect, it } from "vitest";
import { textResult } from "../lib/tools/result.js";

describe("textResult", () => {
  it("serializes JSON data as an MCP text result", () => {
    expect(textResult({ ok: true })).toEqual({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
  });

  it("preserves JSON serialization failures", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => textResult(circular)).toThrow(TypeError);
  });
});
