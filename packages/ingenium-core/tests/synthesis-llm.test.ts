import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { callSynthesisLLM, isLLMSynthesisConfigured, getLLMSynthesisConfig, enrichObservations, getFullLLMSynthesisConfig } from "../lib/tools/synthesis-llm.js";
import { setSetting } from "../lib/tools/settings.js";

let tempDir: string;
let projectId: string;
let globalProjectId: string;
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
  const globalProject = createProject("global-default", true);
  globalProjectId = globalProject.id;

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

  it("clamps trait confidence to [0, 0.95] range", async () => {
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
    expect(result.personality_traits![0].confidence).toBe(0.95);
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
    expect(isLLMSynthesisConfigured("unused-project-id")).toBe(false);
  });

  it("getLLMSynthesisConfig returns null when not configured", () => {
    expect(getLLMSynthesisConfig("unused-project-id")).toBeNull();
  });

  it("reports configured when both settings exist on global project", () => {
    setSetting(globalProjectId, "synthesis_model", "test-model");
    setSetting(globalProjectId, "synthesis_api_key", "test-key");
    expect(isLLMSynthesisConfigured("unused-project-id")).toBe(true);
  });

  it("getLLMSynthesisConfig returns config when configured on global project", () => {
    setSetting(globalProjectId, "synthesis_model", "gpt-4o");
    setSetting(globalProjectId, "synthesis_api_key", "sk-test");
    const config = getLLMSynthesisConfig("unused-project-id");
    expect(config).not.toBeNull();
    expect(config!.model).toBe("gpt-4o");
    expect(config!.apiKey).toBe("sk-test");
  });

  it("reports configured with only model set on global project (apiKey optional)", () => {
    setSetting(globalProjectId, "synthesis_model", "test-model");
    expect(isLLMSynthesisConfigured("unused-project-id")).toBe(true);
  });
});

// ── Live LLM integration test (conditional) ─────────────────

// ── Enrichment tests ────────────────────────────────────────

describe("enrichObservations", () => {
  it("returns empty array for empty input", async () => {
    const result = await enrichObservations([], endpoint(), "model", "key");
    expect(result).toEqual([]);
    expect(mockRequests).toBe(0); // Must not make HTTP request
  });

  it("returns originals when no endpoint or model configured", async () => {
    const obs = [{ type: "correction", content: "no, use 2-space indentation" }];
    const result = await enrichObservations(obs, "", "", "");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
    expect(result[0].content).toBe("no, use 2-space indentation");
    expect(mockRequests).toBe(0);
  });

  it("returns originals when endpoint is null/undefined", async () => {
    const obs = [{ type: "preference", content: "I prefer snake_case" }];
    const result = await enrichObservations(obs, "", "test-model", "test-key");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
  });

  it("uses enriched_content when LLM returns valid enrichment", async () => {
    const enrichmentResponse = [
      { index: 0, content: "no, use 2-space indentation", enriched_content: "User prefers 2-space indentation over 4-space", skip: false },
    ];
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [{ type: "correction", content: "no, use 2-space indentation" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBe("User prefers 2-space indentation over 4-space");
    expect(result[0].content).toBe("no, use 2-space indentation");
    expect(result[0].type).toBe("correction");
  });

  it("skips observations marked as noise by LLM", async () => {
    const enrichmentResponse = [
      { index: 0, content: "this is fucked", enriched_content: null, skip: true },
      { index: 1, content: "no, use 2-space", enriched_content: "User prefers 2-space indentation", skip: false },
    ];
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [
      { type: "correction", content: "this is fucked" },
      { type: "correction", content: "no, use 2-space" },
    ];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(2);
    expect(result[0].skip).toBe(true);
    expect(result[0].enriched_content).toBeUndefined();
    expect(result[1].skip).toBe(false);
    expect(result[1].enriched_content).toBe("User prefers 2-space indentation");
  });

  it("handles json_object wrapping format (model wraps in object)", async () => {
    // Some models return {"observations": [...]} instead of bare [...]
    const enrichmentResponse = { observations: [
      { index: 0, content: "run tests first", enriched_content: "User always runs tests before committing", skip: false },
    ]};
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [{ type: "workflow", content: "run tests first" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].enriched_content).toBe("User always runs tests before committing");
    expect(result[0].skip).toBe(false);
  });

  it("returns originals when LLM returns non-array response", async () => {
    setMockResponse(mockContent(JSON.stringify({ not_enriched: true })));

    const obs = [{ type: "correction", content: "should use tabs" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
    expect(result[0].content).toBe("should use tabs");
  });

  it("returns originals on API error status", async () => {
    setMockResponse({ error: "server error" }, 500);

    const obs = [{ type: "correction", content: "fix the naming" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
  });

  it("returns originals on network error with fallback retry", async () => {
    // Point at unreachable port — will trigger fetch error, retry, then fallback
    const obs = [{ type: "preference", content: "I like concise errors" }];
    const result = await enrichObservations(obs, "http://127.0.0.1:19999", "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
  });

  it("handles AbortSignal cancellation and returns originals", async () => {
    const controller = new AbortController();
    controller.abort();
    const obs = [{ type: "correction", content: "no, use different approach" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key", controller.signal);
    expect(result).toHaveLength(1);
    expect(result[0].skip).toBe(false);
    expect(result[0].enriched_content).toBeUndefined();
  });

  it("includes context in enriched output when provided", async () => {
    const enrichmentResponse = [
      { index: 0, content: "no, use 2-space", enriched_content: "User prefers 2-space indentation", skip: false },
    ];
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [{ type: "correction", content: "no, use 2-space", context: "Agent used 4-space indentation\nUser: no, use 2-space\nAgent: OK switching" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].context).toBe("Agent used 4-space indentation\nUser: no, use 2-space\nAgent: OK switching");
    expect(result[0].enriched_content).toBe("User prefers 2-space indentation");
  });

  it("handles retry with plain format when json_object fails", async () => {
    // First attempt returns 400 (json_object not supported), second attempt succeeds
    let callCount = 0;
    const customServer = createServer((_req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "json_object not supported" }));
      } else {
        const payload = JSON.stringify([
          { index: 0, content: "no, use 2-space", enriched_content: "User prefers 2-space", skip: false },
        ]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: payload } }] }));
      }
    });

    await new Promise<void>((resolve) => customServer.listen(0, resolve));
    const port = (customServer.address() as AddressInfo).port;
    const endpoint = `http://localhost:${port}`;

    const obs = [{ type: "correction", content: "no, use 2-space" }];
    const result = await enrichObservations(obs, endpoint, "model", "key");

    expect(callCount).toBe(2);
    expect(result).toHaveLength(1);
    expect(result[0].enriched_content).toBe("User prefers 2-space");

    await new Promise<void>((resolve) => customServer.close(() => resolve()));
  });

  it("handles short/insufficient enriched_content gracefully", async () => {
    // enriched_content must be > 10 chars, otherwise it's treated as undefined
    const enrichmentResponse = [
      { index: 0, content: "do X", enriched_content: "short", skip: false },
    ];
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [{ type: "correction", content: "do X" }];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(1);
    expect(result[0].enriched_content).toBeUndefined(); // too short
    expect(result[0].skip).toBe(false);
  });

  it("handles missing index entries in LLM response", async () => {
    // Response has only index 2, but we passed 3 observations
    const enrichmentResponse = [
      { index: 2, content: "obs3", enriched_content: "Enriched for obs3", skip: false },
    ];
    setMockResponse(mockContent(JSON.stringify(enrichmentResponse)));

    const obs = [
      { type: "correction", content: "obs1" },
      { type: "preference", content: "obs2" },
      { type: "workflow", content: "obs3" },
    ];
    const result = await enrichObservations(obs, endpoint(), "model", "key");
    expect(result).toHaveLength(3);
    expect(result[0].enriched_content).toBeUndefined(); // no match
    expect(result[1].enriched_content).toBeUndefined(); // no match
    expect(result[2].enriched_content).toBe("Enriched for obs3");
  });
});

describe("getFullLLMSynthesisConfig", () => {
  it("returns null when no global project exists (no settings set)", () => {
    // Note: global project exists from beforeAll, but no settings are set for these
    const config = getFullLLMSynthesisConfig();
    expect(config).toBeNull();
  });

  it("returns config when all settings are configured on global project", () => {
    setSetting(globalProjectId, "synthesis_model", "gpt-4o");
    setSetting(globalProjectId, "synthesis_api_key", "sk-test");
    setSetting(globalProjectId, "synthesis_endpoint", "https://api.openai.com/v1");
    const config = getFullLLMSynthesisConfig();
    expect(config).not.toBeNull();
    expect(config!.model).toBe("gpt-4o");
    expect(config!.apiKey).toBe("sk-test");
    expect(config!.endpoint).toBe("https://api.openai.com/v1");
  });

  it("returns null when endpoint is not configured", () => {
    setSetting(globalProjectId, "synthesis_model", "gpt-4o");
    setSetting(globalProjectId, "synthesis_api_key", "sk-test");
    // Don't set endpoint
    setSetting(globalProjectId, "synthesis_endpoint", "");
    const config = getFullLLMSynthesisConfig();
    expect(config).toBeNull();
  });

  it("returns null when model is not configured", () => {
    setSetting(globalProjectId, "synthesis_model", "");
    setSetting(globalProjectId, "synthesis_api_key", "sk-test");
    setSetting(globalProjectId, "synthesis_endpoint", "https://api.openai.com/v1");
    const config = getFullLLMSynthesisConfig();
    expect(config).toBeNull();
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
