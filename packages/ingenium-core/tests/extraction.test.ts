import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { parseExtractionResponse, callLLMForExtraction } from "../lib/tools/extraction.js";
import { setSetting } from "../lib/tools/settings.js";

let tempDir: string;
let projectId: string;
let mockServer: Server;
let mockPort: number;
let mockResponsePayload: any;
let mockResponseStatus: number;
let mockRequests: number;

function setMockResponse(payload: any, status = 200) {
  mockResponsePayload = payload;
  mockResponseStatus = status;
}

function endpoint(): string {
  return `http://localhost:${mockPort}`;
}

function mockContent(content: string): any {
  return { choices: [{ message: { content } }] };
}

function makeCandidate(text = "User prefers 2-space indentation"): { text: string; time_created: number; hash: string } {
  return { text, time_created: Date.now(), hash: "abc123" };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-extraction-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;

  await new Promise<void>((resolve) => {
    mockServer = createServer((_req, res) => {
      mockRequests++;
      const body = typeof mockResponsePayload === "string"
        ? mockResponsePayload
        : JSON.stringify(mockResponsePayload);
      res.writeHead(mockResponseStatus, { "Content-Type": "application/json" });
      res.end(body);
    });
    mockServer.listen(0, () => {
      mockPort = (mockServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockRequests = 0;
  setMockResponse(mockContent("{}"));
});

// ── parseExtractionResponse tests ──────────────────────────

describe("parseExtractionResponse", () => {
  it("parses valid JSON with rules correctly", () => {
    const raw = JSON.stringify({
      rules: [
        { content: "User prefers 2-space indentation", type: "preference", importance: 7 },
        { content: "User always runs lint before committing", type: "workflow", importance: 8 },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("User prefers 2-space indentation");
    expect(result[0].type).toBe("preference");
    expect(result[0].importance).toBe(7);
    expect(result[1].content).toBe("User always runs lint before committing");
    expect(result[1].type).toBe("workflow");
    expect(result[1].importance).toBe(8);
  });

  it("strips markdown-wrapped JSON fences", () => {
    const raw = '```json\n{"rules":[{"content":"User prefers concise error messages","type":"preference","importance":5}]}\n```';
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("User prefers concise error messages");
  });

  it("returns empty array for empty input", () => {
    expect(parseExtractionResponse("")).toEqual([]);
    expect(parseExtractionResponse("   ")).toEqual([]);
  });

  it("returns empty array for reasoning_only input (empty content → no fallback)", () => {
    // This simulates a reasoning model returning empty content.
    // The old code had a reasoning_content fallback; it's now removed.
    // Empty content means empty rules.
    expect(parseExtractionResponse("{}")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseExtractionResponse("not json at all")).toEqual([]);
    expect(parseExtractionResponse('{"rules": [broken')).toEqual([]);
  });

  it("returns empty array for null/undefined-like inputs", () => {
    expect(parseExtractionResponse("null")).toEqual([]);
  });

  it("normalizes content to start with 'User' prefix", () => {
    const raw = JSON.stringify({
      rules: [
        { content: "Always uses tabs for indentation", type: "preference", importance: 6 },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("User always uses tabs for indentation");
  });

  it("filters out rules with content shorter than 20 characters", () => {
    const raw = JSON.stringify({
      rules: [
        { content: "Short", type: "preference", importance: 5 },
        { content: "User prefers using tabs everywhere in the project", type: "preference", importance: 5 },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("tabs");
  });

  it("maps unknown types to preference", () => {
    const raw = JSON.stringify({
      rules: [
        { content: "User wants descriptive variable names", type: "mystery_type", importance: 5 },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("preference");
  });
});

// ── callLLMForExtraction tests ─────────────────────────────

describe("callLLMForExtraction", () => {
  it("handles error responses with { rules: [], failed: true }", async () => {
    setMockResponse({ error: "server error" }, 500);

    const candidates = [makeCandidate()];
    const result = await callLLMForExtraction(candidates, {
      model: "test-model",
      endpoint: endpoint(),
      allowPrivateNetwork: true,
    });

    expect(result.rules).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("returns rules on successful LLM response", async () => {
    const validResponse = mockContent(JSON.stringify({
      rules: [
        { content: "User prefers 2-space indentation", type: "preference", importance: 7 },
      ],
    }));
    setMockResponse(validResponse);

    const candidates = [makeCandidate()];
    const result = await callLLMForExtraction(candidates, {
      model: "test-model",
      endpoint: endpoint(),
      allowPrivateNetwork: true,
    });

    expect(result.failed).toBe(false);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].content).toBe("User prefers 2-space indentation");
  });

  it("returns 0 rules for reasoning_content-only response (NO fallback to reasoning_content)", async () => {
    // Simulate a reasoning model response where content is empty
    // but reasoning_content has the actual thinking trace.
    // The fix removed the reasoning_content fallback — we should get 0 rules.
    const reasoningOnlyResponse = {
      choices: [
        {
          message: {
            content: "",
            reasoning_content: JSON.stringify({
              rules: [
                { content: "User prefers concise error messages", type: "preference", importance: 5 },
              ],
            }),
          },
        },
      ],
    };
    setMockResponse(reasoningOnlyResponse);

    const candidates = [makeCandidate()];
    const result = await callLLMForExtraction(candidates, {
      model: "test-model",
      endpoint: endpoint(),
      allowPrivateNetwork: true,
    });

    expect(result.failed).toBe(false);
    expect(result.rules).toEqual([]);
  });

  it("handles network errors gracefully", async () => {
    const candidates = [makeCandidate()];
    const result = await callLLMForExtraction(candidates, {
      model: "test-model",
      endpoint: "http://127.0.0.1:19999",
      allowPrivateNetwork: true,
    });

    expect(result.rules).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("handles null/empty content in response gracefully", async () => {
    const nullContent = {
      choices: [{ message: { content: null } }],
    };
    setMockResponse(nullContent);

    const candidates = [makeCandidate()];
    const result = await callLLMForExtraction(candidates, {
      model: "test-model",
      endpoint: endpoint(),
      allowPrivateNetwork: true,
    });

    expect(result.failed).toBe(false);
    expect(result.rules).toEqual([]);
  });
});
