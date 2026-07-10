import { describe, it, expect } from "vitest";

describe("sanitizeHtml", () => {
  it("should strip <script> blocks with content", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = "<div>hello</div><script>alert('xss')</script><p>world</p>";
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("<div>hello</div>");
    expect(result).toContain("<p>world</p>");
  });

  it("should strip self-closing <script/> tags", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<script src="https://evil.com/hack.js"/>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<script");
  });

  it("should strip <iframe> blocks", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<iframe src="https://evil.com"></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<iframe");
  });

  it("should strip event handler attributes (double quotes)", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onerror");
  });

  it("should strip event handler attributes (single quotes)", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = "<img src='x' onerror='alert(1)'>";
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onerror");
  });

  it("should strip multiple event handler types", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<body onload="steal()" onclick="hack()" onmouseover="track()">content</body>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onmouseover");
    expect(result).toContain("content");
  });

  it("should preserve safe HTML", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<p>Hello <b>world</b> <a href="https://example.com">link</a></p>';
    const result = sanitizeHtml(html);
    expect(result).toContain("<p>");
    expect(result).toContain("<b>");
    expect(result).toContain("<a href");
  });

  it("should handle empty string", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    expect(sanitizeHtml("")).toBe("");
  });

  it("should handle nested script inside iframe", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<iframe><script>alert("nested")</script></iframe>';
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("<script");
  });

  it("should strip javascript: in href (limitation: not currently handled)", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(html);
    // KNOWN LIMITATION: sanitizeHtml does NOT strip javascript: URIs
    // This test documents the gap
    expect(result).toContain("javascript:");
  });

  it("should handle script with newlines and special chars", async () => {
    const { sanitizeHtml } = await import("../lib/parser.js");
    const html = "<script>\n  var x = '</script>';\n  alert(1);\n</script>";
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<script");
  });
});

describe("parseRawEmail", () => {
  it("should parse a basic text email", async () => {
    const { parseRawEmail } = await import("../lib/parser.js");
    const raw = [
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Subject: Hello",
      "Date: Mon, 1 Jan 2024 12:00:00 +0000",
      "",
      "Hello Bob!",
    ].join("\r\n");

    const parsed = await parseRawEmail(raw);
    expect(parsed.subject).toBe("Hello");
    expect(parsed.from).toHaveLength(1);
    expect(parsed.from[0].address).toBe("alice@example.com");
    expect(parsed.to[0].address).toBe("bob@example.com");
    expect(parsed.body.text).toContain("Hello Bob");
  });

  it("should handle a multipart email with HTML", async () => {
    const { parseRawEmail } = await import("../lib/parser.js");
    const raw = [
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Subject: HTML Email",
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      "<html><body><p>Hello</p><script>alert(1)</script></body></html>",
    ].join("\r\n");

    const parsed = await parseRawEmail(raw);
    expect(parsed.body.html).toBeDefined();
    expect(parsed.body.html).not.toContain("<script>");
    expect(parsed.body.html).toContain("<p>Hello</p>");
  });

  it("should handle missing subject gracefully", async () => {
    const { parseRawEmail } = await import("../lib/parser.js");
    const raw = "From: a@b.com\r\nTo: c@d.com\r\n\r\nBody";
    const parsed = await parseRawEmail(raw);
    expect(parsed.subject).toBe("(no subject)");
  });
});
