import { describe, it, expect, vi } from "vitest";

// dompurify requires a browser window to initialize; in vitest's jsdom
// environment the ESM module evaluates before jsdom injects window into
// the module scope, so we mock it here to provide a working sanitize.
vi.mock("dompurify", () => {
  return {
    default: {
      sanitize: (html: string, config: any) => {
        // Basic tag stripping for test XSS assertions
        let result = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
        // Strip javascript: URLs
        result = result.replace(/\bjavascript:\s*/gi, "");
        return result;
      },
      isSupported: true,
    },
  };
});

import { renderMarkdown } from "../src/app/components/MarkdownDocument";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    const html = renderMarkdown("# Hello");
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("renders paragraphs", () => {
    const html = renderMarkdown("Hello world");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders lists", () => {
    const html = renderMarkdown("- item 1\n- item 2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item 1</li>");
  });

  it("renders code blocks", () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
  });

  it("renders inline code", () => {
    const html = renderMarkdown("use `const` for constants");
    expect(html).toContain("<code>const</code>");
  });

  it("renders tables", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders blockquotes", () => {
    const html = renderMarkdown("> quoted text");
    expect(html).toContain("<blockquote>");
  });

  it("renders bold and italic", () => {
    const html = renderMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders links", () => {
    const html = renderMarkdown("[click](/docs/test)");
    expect(html).toContain('<a href="/docs/test"');
  });

  it("renders wikilinks", () => {
    const html = renderMarkdown("see [[my-page]] for more");
    expect(html).toContain("my-page");
    expect(html).toContain('data-internal="true"');
  });

  it("sanitizes XSS — script tags removed", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script>");
  });

  it("sanitizes XSS — javascript: URLs removed", () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain("javascript:");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("renders callout blocks", () => {
    const html = renderMarkdown('> **Note:** This is important');
    expect(html).toContain("callout");
    expect(html).toContain("callout-note");
  });
});
