import { describe, it, expect } from "vitest";
import {
  chunkMarkdown,
  chunkPlaintext,
  chunkJSON,
  chunkJSONL,
  chunkText,
  estimateTokens,
} from "../lib/tools/rag-chunker.js";

// ============================================================
// Fixtures
// ============================================================

const markdownFixture = `# Project Overview

This is the project overview section with some introductory content.

## Installation

To install the project, run:

\`\`\`bash
npm install
\`\`\`

Make sure you have Node.js installed.

## Configuration

### Environment Variables

The project uses environment variables for configuration.

### Database

SQLite is used as the database engine.

## Usage

Run the following command to start the server:

\`\`\`bash
npm start
\`\`\`

The server will be available at http://localhost:3000.`;

const plaintextFixture = `The quick brown fox jumps over the lazy dog. This is a simple paragraph used for testing purposes. It is intentionally verbose enough to exceed the minimum character threshold for standalone chunks.

This is the second paragraph. It contains more detailed information about the subject matter being discussed in this test fixture. The quick brown fox jumps over the lazy dog repeatedly in this verbose paragraph that keeps going and going.

Short para.

Another short one.

This is a longer paragraph that should be merged with the short ones above it because the short paragraphs do not meet the minimum character threshold for standalone chunks. This paragraph provides sufficient context to absorb the short fragments above.

A fifth paragraph that adds more content to ensure we have enough text across the fixture to split into multiple chunks when using default max tokens. This paragraph is deliberately verbose to increase the total token count significantly. The quick brown fox jumps over the lazy dog repeatedly.`;

const jsonFixture = `{
  "entries": [
    {"title": "Entry 1", "body": "Content of entry one"},
    {"title": "Entry 2", "body": "Content of entry two"},
    {"title": "Entry 3", "body": "Content of entry three"}
  ]
}`;

const jsonlFixture = `{"role": "user", "content": "Hello, how are you?"}
{"role": "assistant", "content": "I'm doing well, thank you! How can I help you today?"}
{"role": "user", "content": "Can you explain how RAG works?"}
{"role": "assistant", "content": "RAG stands for Retrieval-Augmented Generation. It combines retrieval from a knowledge base with text generation."}`;

const unicodeFixture = `## Greetings in Different Languages

Hello! 你好! ¡Hola! こんにちは!  👋

## Emoji Support

🎉 🚀 💡 🌟 🎯

## CJK Text

日本語のテキストです。これはテスト用の文章です。
中文文本，用于测试分词和编码处理。
한국어 텍스트입니다.`;

// ============================================================
// Token Estimation
// ============================================================

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
  });

  it("produces approximate count within 20% accuracy for English text", () => {
    // Use text without spaces to avoid whitespace discount skew
    const sentence = "The quick brown fox jumps over the lazy dog. X".repeat(10);
    const estimated = estimateTokens(sentence);
    const expected = Math.round(sentence.length / 4);
    const ratio = estimated / expected;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });

  it("handles CJK/Hiragana/Katakana characters as 1 token each", () => {
    // 日 本 語 の テ キ ス ト = 8 characters
    const cjk = "日本語のテキスト";
    expect(estimateTokens(cjk)).toBe(8);
  });

  it("handles emoji characters", () => {
    const emoji = "🎉 🚀 💡";
    expect(estimateTokens(emoji)).toBeGreaterThan(0);
  });
});

// ============================================================
// Markdown Chunking
// ============================================================

describe("chunkMarkdown", () => {
  it("splits by ## headings", () => {
    const chunks = chunkMarkdown(markdownFixture);
    // lead + Installation + Configuration + Usage = 4
    expect(chunks.length).toBe(4);
  });

  it("preserves heading context in chunks", () => {
    const chunks = chunkMarkdown(markdownFixture);
    const installChunk = chunks.find((c) => c.heading === "Installation");
    expect(installChunk).toBeDefined();
    expect(installChunk!.content).toContain("npm install");
  });

  it("assigns lead chunk for content before first ## heading", () => {
    const chunks = chunkMarkdown(markdownFixture);
    const leadChunk = chunks.find((c) => c.heading === undefined);
    expect(leadChunk).toBeDefined();
    expect(leadChunk!.content).toContain("Project Overview");
  });

  it("returns empty array for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   ")).toEqual([]);
  });

  it("handles text without any headings", () => {
    const noHeadings = "Just a plain paragraph.\n\nAnother paragraph.";
    const chunks = chunkMarkdown(noHeadings);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain("Just a plain paragraph");
  });

  it("handles Unicode and CJK content", () => {
    const chunks = chunkMarkdown(unicodeFixture);
    expect(chunks.length).toBe(3);
    const greeting = chunks.find((c) => c.heading === "Greetings in Different Languages");
    expect(greeting).toBeDefined();
    expect(greeting!.content).toContain("Hello!");
  });

  it("splits long sections into multiple chunks when exceeding maxTokens", () => {
    const longPara = "word ".repeat(5000);
    const longText = `## Long Section\n\n${longPara}`;
    const chunks = chunkMarkdown(longText, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.heading).toBe("Long Section"));
  });

  it("sets tokens on each chunk", () => {
    const chunks = chunkMarkdown(markdownFixture);
    chunks.forEach((c) => {
      expect(c.tokens).toBeGreaterThan(0);
    });
  });

  it("passes source option to chunks", () => {
    const chunks = chunkMarkdown(markdownFixture, { source: "test-doc" });
    chunks.forEach((c) => {
      expect(c.source).toBe("test-doc");
    });
  });
});

// ============================================================
// Plaintext Chunking
// ============================================================

describe("chunkPlaintext", () => {
  it("splits by paragraphs into one or more chunks", () => {
    const chunks = chunkPlaintext(plaintextFixture);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("merges short paragraphs with adjacent ones", () => {
    const chunks = chunkPlaintext(plaintextFixture);
    const merged = chunks.find((c) => c.content.includes("Short para"));
    expect(merged).toBeDefined();
    expect(merged!.content).toContain("Another short one");
  });

  it("returns empty array for empty input", () => {
    expect(chunkPlaintext("")).toEqual([]);
    expect(chunkPlaintext("   ")).toEqual([]);
  });

  it("preserves source option", () => {
    const chunks = chunkPlaintext(plaintextFixture, { source: "plain-src" });
    chunks.forEach((c) => expect(c.source).toBe("plain-src"));
  });

  it("honors custom minParagraphChars", () => {
    const text = "A.\n\nB.\n\nLong enough paragraph that should stand alone.";
    const defaultChunks = chunkPlaintext(text);
    const customChunks = chunkPlaintext(text, { minParagraphChars: 5 });
    expect(customChunks.length).toBeGreaterThanOrEqual(defaultChunks.length);
  });
});

// ============================================================
// JSON Chunking
// ============================================================

describe("chunkJSON", () => {
  it("parses {entries: [...]} format", () => {
    const chunks = chunkJSON(jsonFixture);
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.content).toContain("Entry 1");
    expect(chunks[1]!.content).toContain("Entry 2");
    expect(chunks[2]!.content).toContain("Entry 3");
  });

  it("handles a raw JSON array", () => {
    const rawArray = JSON.stringify(["item one", "item two", "item three"]);
    const chunks = chunkJSON(rawArray);
    expect(chunks.length).toBe(3);
  });

  it("returns empty array for empty entries", () => {
    const chunks = chunkJSON('{"entries": []}');
    expect(chunks).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(chunkJSON("")).toEqual([]);
    expect(chunkJSON("   ")).toEqual([]);
  });

  it("falls back to plaintext chunking for non-JSON input", () => {
    const chunks = chunkJSON("not json at all");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toBe("not json at all");
  });

  it("handles object entries as JSON strings", () => {
    const nested = JSON.stringify({
      entries: [{ name: "test", value: 42 }, { name: "test2", value: 99 }],
    });
    const chunks = chunkJSON(nested);
    expect(chunks.length).toBe(2);
  });
});

// ============================================================
// JSONL Chunking
// ============================================================

describe("chunkJSONL", () => {
  it("handles line-delimited JSON format", () => {
    const chunks = chunkJSONL(jsonlFixture);
    expect(chunks.length).toBe(4);
  });

  it("extracts content/message/text field from each line", () => {
    const chunks = chunkJSONL(jsonlFixture);
    expect(chunks[0]!.content).toBe("Hello, how are you?");
    expect(chunks[1]!.content).toContain("I'm doing well");
  });

  it("returns empty array for empty input", () => {
    expect(chunkJSONL("")).toEqual([]);
    expect(chunkJSONL("   ")).toEqual([]);
  });

  it("handles invalid JSON lines as raw content", () => {
    const mixed = '{"valid": "yes"}\ninvalid line\n{"another": "valid"}';
    const chunks = chunkJSONL(mixed);
    expect(chunks.length).toBe(3);
    expect(chunks[1]!.content).toBe("invalid line");
  });

  it("preserves source option", () => {
    const chunks = chunkJSONL(jsonlFixture, { source: "transcript" });
    chunks.forEach((c) => expect(c.source).toBe("transcript"));
  });
});

// ============================================================
// Auto-Detect Chunking (chunkText)
// ============================================================

describe("chunkText", () => {
  it("auto-detects markdown by ## heading", () => {
    const chunks = chunkText(markdownFixture);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const hasHeading = chunks.some((c) => c.heading !== undefined);
    expect(hasHeading).toBe(true);
  });

  it("auto-detects JSON with entries key", () => {
    const chunks = chunkText(jsonFixture);
    expect(chunks.length).toBe(3);
  });

  it("auto-detects JSONL format", () => {
    const chunks = chunkText(jsonlFixture);
    expect(chunks.length).toBe(4);
  });

  it("defaults to plaintext for unknown format", () => {
    const chunks = chunkText(plaintextFixture);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("handles Unicode content", () => {
    const chunks = chunkText(unicodeFixture);
    expect(chunks.length).toBe(3);
  });
});
