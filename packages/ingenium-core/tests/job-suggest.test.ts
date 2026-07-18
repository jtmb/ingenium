import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createProject } from "../lib/tools/projects.js";
import { generateJobConfig } from "../lib/tools/job-suggest-llm.js";
import type { LLMConfig } from "../lib/tools/synthesis-llm.js";

let tempDir: string;
let mockServer: Server;
let mockPort: number;
let mockResponsePayload: any;
let mockResponseStatus: number;

function setMockResponse(payload: any, status = 200) {
  mockResponsePayload = payload;
  mockResponseStatus = status;
}

function endpoint(): string {
  return `http://localhost:${mockPort}`;
}

/** Build an OpenAI-style chat completions response wrapping a content string. */
function mockContent(content: string): any {
  return { choices: [{ message: { content } }] };
}

/** Build a response that has reasoning_content but empty content. */
function mockReasoningOnly(reasoning: string): any {
  return {
    choices: [{ message: { content: "", reasoning_content: reasoning } }],
  };
}

/** Construct an LLMConfig pointing at the mock server. */
function config(): LLMConfig {
  return { model: "test-model", apiKey: "test-key", endpoint: endpoint(), allowPrivateNetwork: true };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-job-suggest-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  // Ensure at least one project exists so resolveLLMConfig can reference it
  createProject("test-project");

  await new Promise<void>((resolve) => {
    mockServer = createServer((_req, res) => {
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
  setMockResponse(mockContent("{}"));
});

// ── Tests ────────────────────────────────────────────────────

describe("generateJobConfig", () => {
  it("returns all nulls for empty description", async () => {
    const result = await generateJobConfig(config(), "");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns all nulls for whitespace-only description", async () => {
    const result = await generateJobConfig(config(), "   \t\n  ");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns all nulls when no model is configured", async () => {
    const result = await generateJobConfig(
      { model: "", endpoint: endpoint() },
      "some description",
    );
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns non-null cron for a scheduled job description", async () => {
    const llmResponse = {
      prompt_template: "Check all open pull requests and summarize any new changes since your last run. Use the GitHub CLI tools.",
      schedule_cron: "0 9 * * 1-5",
      trigger_event: null,
    };
    setMockResponse(mockContent(JSON.stringify(llmResponse)));

    const result = await generateJobConfig(config(), "Check PRs every weekday at 9am");
    expect(result.prompt_template).toBe(llmResponse.prompt_template);
    expect(result.schedule_cron).toBe("0 9 * * 1-5");
    expect(result.trigger_event).toBeNull();
  });

  it("returns non-null trigger_event for an event-driven job description", async () => {
    const llmResponse = {
      prompt_template: "When a new issue is created, analyze its content and assign appropriate labels and reviewers.",
      schedule_cron: null,
      trigger_event: "issue.created",
    };
    setMockResponse(mockContent(JSON.stringify(llmResponse)));

    const result = await generateJobConfig(config(), "Auto-label new GitHub issues when they are created");
    expect(result.trigger_event).toBe("issue.created");
    expect(result.schedule_cron).toBeNull();
    expect(result.prompt_template).toBe(llmResponse.prompt_template);
  });

  it("returns all nulls for malformed LLM JSON response", async () => {
    setMockResponse(mockContent("not json at all — no braces here"));

    const result = await generateJobConfig(config(), "Do something useful");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns all nulls when LLM returns empty content", async () => {
    // Empty content → the guard before tryParseJSON kicks in
    setMockResponse(mockContent(""));

    const result = await generateJobConfig(config(), "Do something");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns all nulls when content is present but empty and reasoning_content is populated (NO fallback)", async () => {
    // 🔴 HARD RULE: never fall back to reasoning_content.
    // The model uses it for internal thinking; exposing it is wrong.
    setMockResponse(mockReasoningOnly("The user wants a cron job that runs every Monday at 8am..."));

    const result = await generateJobConfig(config(), "Run every Monday morning");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("returns all nulls when content is whitespace-only even with reasoning_content present", async () => {
    // Whitespace content (length > 0, but trim().length === 0) also caught
    setMockResponse({
      choices: [{ message: { content: "   \n\t  ", reasoning_content: "thinking..." } }],
    });

    const result = await generateJobConfig(config(), "Do something");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("handles LLM returning null literal in content", async () => {
    setMockResponse(mockContent("null"));

    // null is != string, so tryParseJSON returns null → validateResult({}) → all nulls
    const result = await generateJobConfig(config(), "Test");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("truncates description to 2000 characters", async () => {
    // Build a description that exceeds 2000 chars
    const longDesc = "A".repeat(3000);
    // The LLM should receive a truncated version; any valid JSON response works
    setMockResponse(mockContent(JSON.stringify({
      prompt_template: "Do the long thing.",
      schedule_cron: null,
      trigger_event: null,
    })));

    const result = await generateJobConfig(config(), longDesc);
    expect(result.prompt_template).toBe("Do the long thing.");
    // The function didn't crash on oversized input
  });

  it("truncates output fields to their limits", async () => {
    const tooLong = "x".repeat(5000);
    setMockResponse(mockContent(JSON.stringify({
      prompt_template: tooLong,
      schedule_cron: tooLong,
      trigger_event: tooLong,
    })));

    const result = await generateJobConfig(config(), "Test truncation");
    expect(result.prompt_template).toHaveLength(4000);
    expect(result.schedule_cron).toHaveLength(100);
    expect(result.trigger_event).toHaveLength(100);
  });

  it("handles API 500 error gracefully (returns all nulls, no throw)", async () => {
    setMockResponse({ error: "internal server error" }, 500);

    const result = await generateJobConfig(config(), "Test");
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("handles network error gracefully (no endpoint, no throw)", async () => {
    const result = await generateJobConfig(
      { model: "test", endpoint: "http://127.0.0.1:19999", allowPrivateNetwork: true },
      "Test network error",
    );
    expect(result).toEqual({
      prompt_template: null,
      schedule_cron: null,
      trigger_event: null,
    });
  });

  it("strips markdown code fences from LLM response", async () => {
    const jsonInFences = '```json\n{"prompt_template":"Do things.","schedule_cron":"0 */2 * * *","trigger_event":null}\n```';
    setMockResponse(mockContent(jsonInFences));

    const result = await generateJobConfig(config(), "Run every 2 hours");
    expect(result.prompt_template).toBe("Do things.");
    expect(result.schedule_cron).toBe("0 */2 * * *");
  });

  it("extracts JSON from text that contains additional content", async () => {
    // Some models might wrap JSON in explanatory text
    const textWithJson = 'Here is the configuration: {"prompt_template":"Check logs.", "schedule_cron":"0 0 * * 0", "trigger_event":null}';
    setMockResponse(mockContent(textWithJson));

    const result = await generateJobConfig(config(), "Check logs weekly on Sunday");
    expect(result.prompt_template).toBe("Check logs.");
    expect(result.schedule_cron).toBe("0 0 * * 0");
  });

  it("parses JSON where non-string values are given for fields (defensive)", async () => {
    // Simulate LLM returning numbers/booleans instead of strings
    setMockResponse(mockContent(JSON.stringify({
      prompt_template: 42,
      schedule_cron: true,
      trigger_event: null,
    })));

    // validateResult checks typeof === "string", so non-strings become null
    const result = await generateJobConfig(config(), "Test");
    expect(result.prompt_template).toBeNull();
    expect(result.schedule_cron).toBeNull();
    expect(result.trigger_event).toBeNull();
  });
});
