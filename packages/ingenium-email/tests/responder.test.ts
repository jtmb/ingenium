import { describe, it, expect } from "vitest";

describe("extractTemplate", () => {
  it("should extract a template between ```template markers", async () => {
    const { extractTemplate } = await import("../lib/responder.js");
    const skill = `Some intro text

\`\`\`template
Thank you for your email, {{sender}}.

We will review {{subject}} and get back to you by {{date}}.
\`\`\`

Some footer text`;
    const result = extractTemplate(skill);
    expect(result).toBe(
      "Thank you for your email, {{sender}}.\n\nWe will review {{subject}} and get back to you by {{date}}."
    );
  });

  it("should return null when no template markers exist", async () => {
    const { extractTemplate } = await import("../lib/responder.js");
    const skill = "Just some regular text without template markers";
    const result = extractTemplate(skill);
    expect(result).toBeNull();
  });

  it("should return null for empty content", async () => {
    const { extractTemplate } = await import("../lib/responder.js");
    expect(extractTemplate("")).toBeNull();
  });

  it("should handle template with no trailing newline", async () => {
    const { extractTemplate } = await import("../lib/responder.js");
    const skill = 'prefix\n```template\ninline template\n```';
    const result = extractTemplate(skill);
    expect(result).toBe("inline template");
  });

  it("should handle case-insensitive template marker", async () => {
    const { extractTemplate } = await import("../lib/responder.js");
    const skill = 'prefix\n```TEMPLATE\ncase insensitive\n```';
    const result = extractTemplate(skill);
    expect(result).toBe("case insensitive");
  });
});

describe("fillTemplate", () => {
  it("should replace {{sender}}, {{subject}}, {{date}} placeholders", async () => {
    const { fillTemplate } = await import("../lib/responder.js");
    const template = "Hi {{sender}}, re: {{subject}} on {{date}}.";
    const result = fillTemplate(template, {
      sender: "Alice",
      subject: "Meeting Tomorrow",
      date: "Jan 1, 2024",
    });
    expect(result).toBe("Hi Alice, re: Meeting Tomorrow on Jan 1, 2024.");
  });

  it("should handle multiple occurrences of the same placeholder", async () => {
    const { fillTemplate } = await import("../lib/responder.js");
    const template = "{{sender}} {{sender}} {{sender}}";
    const result = fillTemplate(template, { sender: "echo", subject: "", date: "" });
    expect(result).toBe("echo echo echo");
  });

  it("should leave unknown placeholders unchanged", async () => {
    const { fillTemplate } = await import("../lib/responder.js");
    const template = "Hello {{sender}}, your {{unknown_var}} is ready.";
    const result = fillTemplate(template, { sender: "Bob", subject: "", date: "" });
    expect(result).toContain("{{unknown_var}}");
  });

  it("should handle empty vars gracefully", async () => {
    const { fillTemplate } = await import("../lib/responder.js");
    const result = fillTemplate("{{sender}}-{{subject}}", { sender: "", subject: "", date: "" });
    expect(result).toBe("-");
  });
});

describe("suggestResponse", () => {
  it("should return null for non-existent email (no cache)", async () => {
    const { suggestResponse } = await import("../lib/responder.js");
    // suggestResponse now uses cache-based lookup (no IMAP).
    // A non-existent account + uid returns null gracefully — no error.
    const result = await suggestResponse("test-project", "bad-account", 1);
    expect(result).toBeNull();
  });
});
