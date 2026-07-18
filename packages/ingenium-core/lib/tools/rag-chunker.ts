/**
 * RAG chunker — splits text into semantically meaningful chunks
 * for ingestion into the RAG search index.
 *
 * Supported formats:
 * - Markdown: splits by ## headings, preserves heading context
 * - Plaintext: splits by paragraphs, merges short ones
 * - JSON: parses {entries: [...]} format
 * - JSONL: handles Copilot transcript format
 */

export interface Chunk {
  id: number;
  content: string;
  heading?: string;
  source?: string;
  tokens: number;
}

export interface ChunkOptions {
  /** Maximum tokens per chunk (approximate) */
  maxTokens?: number;
  /** Minimum characters for a standalone paragraph */
  minParagraphChars?: number;
  /** Source identifier for chunks */
  source?: string;
}

/** Estimate token count: ~4 chars per token on average */
export function estimateTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp >= 0x4E00 && cp <= 0x9FFF) { count += 1; }
    else if (cp >= 0x3040 && cp <= 0x309F) { count += 1; }      // Hiragana
    else if (cp >= 0x30A0 && cp <= 0x30FF) { count += 1; }      // Katakana
    else if (cp >= 0xAC00 && cp <= 0xD7AF) { count += 1; }      // Hangul
    else if (cp >= 0xFF01 && cp <= 0xFF60) { count += 1; }      // Fullwidth
    else if (cp >= 0x3400 && cp <= 0x4DBF) { count += 1; }      // CJK Ext A
    else if (cp >= 0xF900 && cp <= 0xFAFF) { count += 1; }      // CJK Compatibility
    else if (cp === 32 || cp === 10 || cp === 9 || cp === 13) { continue; } // whitespace
    else if (cp > 0xFFFF) { count += 1; i++; }                   // Astral plane
    else { count += 0.25; }                                      // ASCII + rest
  }
  return Math.max(1, Math.round(count));
}

/**
 * Chunk markdown text by ## headings.
 * Each chunk includes the heading context + content under it.
 * Content before the first ## heading is assigned a "lead" chunk.
 */
export function chunkMarkdown(text: string, options: ChunkOptions = {}): Chunk[] {
  if (!text || !text.trim()) return [];

  const { maxTokens = 2000, source: src } = options;
  const chunks: Chunk[] = [];
  let id = 0;

  // Split on ## headings (but not ### or #)
  const sections = text.split(/(?=^##\s)/m);

  let currentHeading = "";
  let currentContent = "";
  let currentTokens = 0;

  function flush(): void {
    if (!currentContent.trim()) return;
    if (currentTokens > maxTokens) {
      const paragraphs = currentContent.split(/\n\s*\n/).filter(Boolean);
      if (paragraphs.length > 1) {
        let paraBuffer = "";
        let paraTokens = 0;
        for (const para of paragraphs) {
          const t = estimateTokens(para);
          if (paraTokens + t > maxTokens && paraBuffer) {
            chunks.push({ id: id++, content: paraBuffer.trim(), heading: currentHeading || undefined, source: src, tokens: paraTokens });
            paraBuffer = "";
            paraTokens = 0;
          }
          paraBuffer += (paraBuffer ? "\n\n" : "") + para;
          paraTokens += t;
        }
        if (paraBuffer.trim()) {
          chunks.push({ id: id++, content: paraBuffer.trim(), heading: currentHeading || undefined, source: src, tokens: paraTokens });
        }
      } else {
        const avgCharsPerToken = currentContent.length / currentTokens;
        const maxChars = Math.floor(maxTokens * avgCharsPerToken);
        let offset = 0;
        while (offset < currentContent.length) {
          const end = Math.min(offset + maxChars, currentContent.length);
          const slice = currentContent.slice(offset, end).trim();
          if (slice) {
            chunks.push({ id: id++, content: slice, heading: currentHeading || undefined, source: src, tokens: estimateTokens(slice) });
          }
          offset = end;
        }
      }
    } else {
      chunks.push({ id: id++, content: currentContent.trim(), heading: currentHeading || undefined, source: src, tokens: currentTokens });
    }
  }

  for (const section of sections) {
    if (!section.trim()) continue;
    const headingMatch = section.match(/^##\s+(.+)/m);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1]!.trim();
      const body = section.replace(/^##\s+.+(\n|$)/, "").trim();
      currentContent = body;
      currentTokens = estimateTokens(currentContent);
    } else if (!currentHeading) {
      currentContent = section.trim();
      currentTokens = estimateTokens(currentContent);
    } else {
      currentContent += "\n\n" + section.trim();
      currentTokens = estimateTokens(currentContent);
    }
  }
  flush();
  return chunks;
}

/**
 * Chunk plain text by paragraphs (double newline).
 * Merges short paragraphs (< minParagraphChars) with the next one.
 */
export function chunkPlaintext(text: string, options: ChunkOptions = {}): Chunk[] {
  if (!text || !text.trim()) return [];

  const { maxTokens = 2000, minParagraphChars = 100, source: src } = options;
  const chunks: Chunk[] = [];
  let id = 0;

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // Merge short paragraphs
  const merged: string[] = [];
  for (const para of paragraphs) {
    if (merged.length > 0 && (para.length < minParagraphChars || merged[merged.length - 1]!.length < minParagraphChars)) {
      merged[merged.length - 1] += "\n\n" + para;
    } else {
      merged.push(para);
    }
  }

  // Group merged paragraphs into chunks respecting maxTokens
  let buffer = "";
  let bufferTokens = 0;

  for (const para of merged) {
    const t = estimateTokens(para);
    if (bufferTokens + t > maxTokens && buffer) {
      chunks.push({ id: id++, content: buffer.trim(), source: src, tokens: bufferTokens });
      buffer = "";
      bufferTokens = 0;
    }
    buffer += (buffer ? "\n\n" : "") + para;
    bufferTokens += t;
  }

  if (buffer.trim()) {
    chunks.push({ id: id++, content: buffer.trim(), source: src, tokens: bufferTokens });
  }

  return chunks;
}

/**
 * Chunk JSON in {entries: [...]} format.
 * Each entry becomes one chunk. Falls back to plaintext for non-JSON.
 */
export function chunkJSON(text: string, options: ChunkOptions = {}): Chunk[] {
  if (!text || !text.trim()) return [];

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return chunkPlaintext(text, options);
  }

  const chunks: Chunk[] = [];
  let id = 0;

  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray(data.entries)
      ? data.entries
      : null;

  if (!list) {
    // Treat as plain text
    return chunkPlaintext(text, options);
  }

  for (const entry of list) {
    const content = typeof entry === "string" ? entry : JSON.stringify(entry);
    chunks.push({ id: id++, content, source: options.source, tokens: estimateTokens(content) });
  }

  return chunks;
}

/**
 * Chunk JSONL (line-delimited JSON, e.g. Copilot transcripts).
 * Each line is parsed independently; invalid lines included as raw content.
 */
export function chunkJSONL(text: string, options: ChunkOptions = {}): Chunk[] {
  if (!text || !text.trim()) return [];

  const chunks: Chunk[] = [];
  let id = 0;

  const lines = text.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    let content = line;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        content = parsed.content ?? parsed.message ?? parsed.text ?? JSON.stringify(parsed);
      }
    } catch {
      // Keep raw line as content
    }
    chunks.push({ id: id++, content, source: options.source, tokens: estimateTokens(content) });
  }

  return chunks;
}

/**
 * Auto-detect format and chunk accordingly.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  if (!text || !text.trim()) return [];

  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.includes('"entries"')) {
    return chunkJSON(text, options);
  }
  if (trimmed.startsWith("[")) {
    return chunkJSON(text, options);
  }
  // JSONL: multiple lines each starting with { or [
  const firstLines = trimmed.split("\n").filter((l) => l.trim()).slice(0, 3);
  const jsonlLike = firstLines.length > 1 && firstLines.every((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
  if (jsonlLike) {
    return chunkJSONL(text, options);
  }
  if (/^##\s/m.test(trimmed)) {
    return chunkMarkdown(text, options);
  }
  return chunkPlaintext(text, options);
}
