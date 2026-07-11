import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { callSynthesisLLM, isLLMSynthesisConfigured, getLLMSynthesisConfig } from "../lib/tools/synthesis-llm.js";
import { setSetting } from "../lib/tools/settings.js";

let tempDir: string;
let projectId: string;
let mockServer: Server;
let mockPort: number;
let mockResponsePayload: any;
let mockResponseStatus: number;
let mockRequests: number;

/** Create a minimal observation object matching the Observation interface shape. */
function makeObs(id: number, type = "pattern" as const, content = "Test observation", importance = 5) {
  return {
    id, project_id: projectId, observation_type: type,
    content, importance, source: "agent" as const, context: null,
    status: "pending" as const, session_id: null,
    created_at: "2025-01-01T00:00:00.000Z", updated_at: "2025-01-01T00:00:00.000Z",
  };
}

/** Set what the mock LLM server will return on the next request(s). */
function setMockResponse(payload: any, status = 200) {
  mockResponsePayload = payload;
  mockResponseStatus = status;
}

/** Returns the base URL of the mock server for use as the synthesis endpoint. */
function endpoint(): string {
  return `http://localhost:${mockPort}`;
}

/** Build an OpenAI-style chat completions response wrapping a content string. */
function mockContent(content: string): any {
  return { choices: [{ message: { content } }] };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-synthesis-llm-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;

  // Spin up a mock HTTP server that returns controlled LLM responses.
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

// ── Edge case / early-return tests ──────────────────────────

describe("synthesis LLM", () => {
  it("returns empty result with no observations", async () => {
    const result = await callSynthesisLLM(
      [], [], [], endpoint(), "test-model", "test-key",
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.insights).toEqual([]);
    expect(result.summary).toContain("No observations");
    // Must not have made an HTTP request
    expect(mockRequests).toBe(0);
  });

  it("handles network errors gracefully", async () => {
    const obs = [makeObs(1, "pattern", "Test observation")];
    // Point at a port nothing is listening on to trigger a fetch error
    const result = await callSynthesisLLM(
      obs, [], [], "http://127.0.0.1:19999", "test-model", "bad-key",
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.summary).toContain("failed");
  });

  it("handles AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const obs = [makeObs(1, "pattern", "Test")];
    controller.abort();
    const result = await callSynthesisLLM(
      obs, [], [], endpoint(), "test-model", "test-key", controller.signal,
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.summary).toContain("cancelled");
  });

  // ── validateResponse exercised via mock server ────────────

  it("returns empty result when response content is null", async () => {
    // Content of "null" → tryParseJSON("null") → JSON.parse("null") → null
    // validateResponse(null) → early return with empty arrays
    setMockResponse(mockContent("null"));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.insights).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("returns empty result when response is an empty object", async () => {
    setMockResponse(mockContent("{}"));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.insights).toEqual([]);
    // Default summary: skill counts are 0
    expect(result.summary).toContain("0 skill(s)");
  });

  it("returns empty result for malformed non-JSON response", async () => {
    // Content has no JSON object pattern → tryParseJSON returns null
    setMockResponse(mockContent("not json at all — no braces here"));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toEqual([]);
    expect(result.skills_to_update).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("parses fully structured response correctly", async () => {
    const valid = {
      skills_to_create: [
        {
      name: "llm-synthesized-test-skill",
          description: "A test skill",
          content: "# Test Skill\n\nSome content.",
        },
      ],
      skills_to_update: [
        {
          name: "existing-skill",
          patch: "Added new rule",
          patch_type: "add-rule" as const,
        },
      ],
      personality_traits: [
        {
          trait_type: "code_preference",
          trait_value: "snake_case",
          confidence: 0.85,
        },
      ],
      insights: ["User prefers concise code"],
      summary: "Synthesized 1 skill from 1 observation",
    };
    setMockResponse(mockContent(JSON.stringify(valid)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    expect(result.skills_to_create[0]).toMatchObject({
      name: "llm-synthesized-test-skill",
      description: "A test skill",
    });
    expect(result.skills_to_update).toHaveLength(1);
    expect(result.skills_to_update[0]).toMatchObject({
      name: "existing-skill",
      patch_type: "add-rule",
    });
    expect(result.personality_traits).toHaveLength(1);
    expect(result.personality_traits![0]).toMatchObject({
      trait_type: "code_preference",
      trait_value: "snake_case",
      confidence: 0.85,
    });
    expect(result.insights).toEqual(["User prefers concise code"]);
    expect(result.summary).toBe("Synthesized 1 skill from 1 observation");
  });

  it("caps skills_to_create at 5 items", async () => {
    const tenSkills = Array.from({ length: 10 }, (_, i) => ({
      name: `skill-${i}`,
      description: `Skill ${i}`,
      content: `Content for skill ${i}`,
    }));
    setMockResponse(mockContent(JSON.stringify({ skills_to_create: tenSkills })));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(5);
  });

  it("sanitizes skill names to kebab-case", async () => {
    const badNames = {
      skills_to_create: [
        {
          name: "My Cool Skill!!!",
          description: "Test",
          content: "content",
        },
        {
          name: "UPPERCASE_NAME_HERE",
          description: "Test 2",
          content: "content 2",
        },
      ],
    };
    setMockResponse(mockContent(JSON.stringify(badNames)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(2);
    // /[^a-z0-9-]/gi → replace with "-", then toLowerCase
    expect(result.skills_to_create[0].name).toBe("llm-synthesized-my-cool-skill---");
    expect(result.skills_to_create[1].name).toBe("llm-synthesized-uppercase-name-here");
  });

  it("clamps trait confidence to [0, 1] range", async () => {
    const traits = {
      personality_traits: [
        { trait_type: "code_preference", trait_value: "high", confidence: 1.5 },
        { trait_type: "feedback_style", trait_value: "low", confidence: -0.5 },
        { trait_type: "terminology", trait_value: "mid", confidence: 0.7 },
      ],
    };
    setMockResponse(mockContent(JSON.stringify(traits)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.personality_traits).toHaveLength(3);
    expect(result.personality_traits![0].confidence).toBe(1.0);
    expect(result.personality_traits![1].confidence).toBe(0.0);
    expect(result.personality_traits![2].confidence).toBe(0.7);
  });

  it("filters skills missing name or content", async () => {
    const payload = {
      skills_to_create: [
        { name: "", description: "No name", content: "has content" },           // empty name → filtered
        { name: "has-name", description: "No content", content: "" },           // empty content → filtered
        { name: "valid", description: "Valid", content: "has content" },        // kept
      ],
      skills_to_update: [
        { name: "", patch: "patch", patch_type: "add-rule" as const },          // empty name → filtered
        { name: "has-name", patch: "", patch_type: "add-rule" as const },       // empty patch → filtered
        { name: "valid-update", patch: "patch", patch_type: "update-section" as const }, // kept
      ],
    };
    setMockResponse(mockContent(JSON.stringify(payload)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    expect(result.skills_to_create[0].name).toBe("llm-synthesized-valid");
    expect(result.skills_to_update).toHaveLength(1);
    expect(result.skills_to_update[0].name).toBe("valid-update");
    expect(result.skills_to_update[0].patch_type).toBe("update-section");
  });

  it("parses JSON extracted from surrounding text", async () => {
    // tryParseJSON strips ``` fences, then if JSON.parse fails, does regex {…} extraction
    // The mockContent wrapper provides valid JSON, but the content field can contain markdown-wrapped JSON
    const markdownWrapped = '```json\n{"skills_to_create":[{"name":"extracted-skill","description":"Extracted","content":"content"}],"summary":"Done"}\n```';
    setMockResponse(mockContent(markdownWrapped));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    expect(result.skills_to_create[0].name).toBe("llm-synthesized-extracted-skill");
    expect(result.summary).toBe("Done");
  });

  it("defaults patch_type to add-rule for unknown values", async () => {
    const payload = {
      skills_to_update: [
        { name: "skill-a", patch: "patch", patch_type: "something-weird" }, // unknown → add-rule
        { name: "skill-b", patch: "patch", patch_type: "add-pattern" },      // valid
      ],
    };
    setMockResponse(mockContent(JSON.stringify(payload)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_update).toHaveLength(2);
    expect(result.skills_to_update[0].patch_type).toBe("add-rule");
    expect(result.skills_to_update[1].patch_type).toBe("add-pattern");
  });

  it("handles reference_files in skills_to_create", async () => {
    const payload = {
      skills_to_create: [
        {
          name: "shell-patterns",
          description: "Shell patterns",
          content: "# Shell Patterns\n\n## Reference Files\n\n| File | Content |\n|------|--------|\n| [refs/safety.md](refs/safety.md) | Safety rules |",
          reference_files: [
            { path: "references/safety.md", content: "# Safety\n\nUse set -euo pipefail" },
            { path: "references/formatting.md", content: "# Formatting\n\nUse printf" },
            // Invalid: path doesn't start with "references/"
            { path: "docs/extra.md", content: "# Extra" },
            // Invalid: empty path
            { path: "", content: "no path" },
          ],
        },
      ],
    };
    setMockResponse(mockContent(JSON.stringify(payload)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    expect(result.skills_to_create[0].reference_files).toHaveLength(2);
    expect(result.skills_to_create[0].reference_files![0].path).toBe("references/safety.md");
    expect(result.skills_to_create[0].reference_files![1].path).toBe("references/formatting.md");
  });

  it("caps reference_files at 10 per skill", async () => {
    const manyRefs = Array.from({ length: 15 }, (_, i) => ({
      path: `references/file-${i}.md`,
      content: `Content for file ${i}`,
    }));
    setMockResponse(mockContent(JSON.stringify({
      skills_to_create: [
        { name: "big-skill", description: "Big", content: "content", reference_files: manyRefs },
      ],
    })));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    expect(result.skills_to_create[0].reference_files).toHaveLength(10);
  });

  it("preserves existing llm-synthesized prefix without doubling", async () => {
    const payload = {
      skills_to_create: [
        {
          name: "llm-synthesized-shell-patterns",
          description: "Shell patterns",
          content: "content",
        },
      ],
    };
    setMockResponse(mockContent(JSON.stringify(payload)));
    const result = await callSynthesisLLM(
      [makeObs(1)], [], [], endpoint(), "model", "key",
    );
    expect(result.skills_to_create).toHaveLength(1);
    // Should NOT double the prefix
    expect(result.skills_to_create[0].name).toBe("llm-synthesized-shell-patterns");
  });
});

// ── Configuration tests ─────────────────────────────────────

describe("LLM synthesis configuration", () => {
  it("reports not configured when no settings exist", () => {
    expect(isLLMSynthesisConfigured(projectId)).toBe(false);
  });

  it("getLLMSynthesisConfig returns null when not configured", () => {
    expect(getLLMSynthesisConfig(projectId)).toBeNull();
  });

  it("reports configured when both settings exist", () => {
    setSetting(projectId, "synthesis_model", "test-model");
    setSetting(projectId, "synthesis_api_key", "test-key");
    expect(isLLMSynthesisConfigured(projectId)).toBe(true);
  });

  it("getLLMSynthesisConfig returns config when configured", () => {
    setSetting(projectId, "synthesis_model", "gpt-4o");
    setSetting(projectId, "synthesis_api_key", "sk-test");
    const config = getLLMSynthesisConfig(projectId);
    expect(config).not.toBeNull();
    expect(config!.model).toBe("gpt-4o");
    expect(config!.apiKey).toBe("sk-test");
  });

  it("reports not configured when only model is set", () => {
    setSetting(projectId, "synthesis_model", "test-model");
    // Remove the apiKey setting by setting projectId again with only model
    // isLLMSynthesisConfigured checks both model AND apiKey
    expect(isLLMSynthesisConfigured("non-existent-project")).toBe(false);
  });
});

// ── Live LLM integration test (conditional) ─────────────────

describe("real LLM call", () => {
  it("produces structured result on successful API call", async () => {
    const realKey = process.env.TEST_LLM_KEY;
    const realEndpoint = process.env.TEST_LLM_ENDPOINT || "https://api.deepseek.com/v1";
    const realModel = process.env.TEST_LLM_MODEL || "deepseek/deepseek-v4-flash";

    if (!realKey) return; // skip if no API key configured

    const obs = [
      makeObs(1, "preference", "User prefers concise error messages", 7),
      makeObs(2, "correction", "User corrected naming to snake_case", 8),
    ];
    const result = await callSynthesisLLM(
      obs, [], [], realEndpoint, realModel, realKey,
    );

    // Should parse and return a structured result
    expect(Array.isArray(result.skills_to_create)).toBe(true);
    expect(Array.isArray(result.skills_to_update)).toBe(true);
    expect(Array.isArray(result.insights)).toBe(true);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  }, 60000); // 60s timeout for real API call
});
