import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { logEvent, getEvents, getTimeline } from "../lib/tools/pipeline-events.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-pipeline-events-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("pipeline events", () => {
  it("logs a session_created event", () => {
    const evt = logEvent(projectId, "session_created", "plugin", "Session started", "New OpenCode session", {});
    expect(evt.event_type).toBe("session_created");
    expect(evt.event_source).toBe("plugin");
    expect(evt.title).toBe("Session started");
    expect(evt.id).toBeGreaterThan(0);
    expect(evt.created_at).toBeTruthy();
  });

  it("logs an observation_created event with importance", () => {
    const evt = logEvent(projectId, "observation_created", "agent", "User prefers snake_case", "correction observation", { observation_type: "correction" }, undefined, undefined, 7);
    expect(evt.importance).toBe(7);
    expect(evt.event_source).toBe("agent");
  });

  it("logs multiple events and lists them", () => {
    logEvent(projectId, "synthesis_triggered", "plugin", "Synthesis triggered", "3 pending", { pending: 3 });
    logEvent(projectId, "synthesis_started", "synthesis", "Synthesis started", "", { batch_size: 3 });
    
    const events = getEvents(projectId);
    expect(events.length).toBeGreaterThanOrEqual(4); // 2 from before + 2 from this test
  });

  it("filters events by source", () => {
    const pluginEvents = getEvents(projectId, { source: "plugin" });
    expect(pluginEvents.length).toBeGreaterThanOrEqual(1);
    pluginEvents.forEach(e => expect(e.event_source).toBe("plugin"));
  });

  it("filters events by type", () => {
    const obsEvents = getEvents(projectId, { type: "observation_created" });
    expect(obsEvents.length).toBeGreaterThanOrEqual(1);
    obsEvents.forEach(e => expect(e.event_type).toBe("observation_created"));
  });

  it("filters events by since timestamp", () => {
    const now = new Date().toISOString();
    const afterNow = getEvents(projectId, { since: now });
    // Events created after 'now' should be 0 (since we already created them)
    expect(afterNow.length).toBe(0);
    
    const before = new Date(0).toISOString();
    const all = getEvents(projectId, { since: before });
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("links child events via parent_event_id", () => {
    const parent = logEvent(projectId, "synthesis_started", "synthesis", "Synthesis run #1");
    const child1 = logEvent(projectId, "trait_created", "synthesis", "Created code_preference", "", {}, parent.id);
    const child2 = logEvent(projectId, "synthesis_completed", "synthesis", "Synthesis done", "", { processed: 3 }, parent.id);

    // Get parent with children
    const parents = getEvents(projectId, { type: "synthesis_started" });
    expect(parents.length).toBeGreaterThanOrEqual(1);
    
    // Get children by parent
    const children = getEvents(projectId, { parentEventId: parent.id });
    expect(children.length).toBe(2);
  });

  it("returns timeline with nested children", () => {
    // Create a full run: triggered → started → [trait_created, trait_updated] → completed
    const trigger = logEvent(projectId, "synthesis_triggered", "plugin", "Trigger batch #2");
    const start = logEvent(projectId, "synthesis_started", "synthesis", "Start batch #2", "", { count: 2 }, trigger.id);
    logEvent(projectId, "trait_created", "synthesis", "Trait: foo", "", {}, start.id);
    logEvent(projectId, "trait_updated", "synthesis", "Trait: bar boosted", "", {}, start.id);
    logEvent(projectId, "synthesis_completed", "synthesis", "Done batch #2", "", { processed: 2 }, start.id);

    const timeline = getTimeline(projectId, { limit: 10 });
    
    // Timeline includes top-level events
    expect(timeline.length).toBeGreaterThanOrEqual(1);
    
    // At least one parent should have children nested
    const hasChildren = timeline.some(e => {
      if (e.data) {
        try {
          const parsed = JSON.parse(e.data);
          return Array.isArray(parsed.children) && parsed.children.length > 0;
        } catch { return false; }
      }
      return false;
    });
    expect(hasChildren).toBe(true);
  });

  it("limits results", () => {
    const limited = getEvents(projectId, { limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });
});
