import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GOAL_TOOLS, excludedAgent, setupScopedGoals } from "./goal-plugin-scope.mjs";

test("vendored server matches the pinned upstream package", async () => {
  const provenance = JSON.parse(await readFile(new URL("./vendor/opencode-goal-plugin/provenance.json", import.meta.url), "utf8"));
  const server = await readFile(new URL("./vendor/opencode-goal-plugin/server.mjs", import.meta.url));
  assert.equal(provenance.version, "0.1.67");
  assert.equal(createHash("sha256").update(server).digest("hex"), provenance.serverSha256);
});

test("native goals persist; Chat receives no tools, reminders, commands or continuation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ingenium-goal-scope-"));
  process.env.OPENCODE_GOAL_STATE_PATH = join(root, "goals.json");
  const { default: upstream } = await import("./vendor/opencode-goal-plugin/server.mjs");
  const tools = new Map(), commands = new Map(), sessionHooks = new Map(), toolHooks = new Map();
  const sessions = new Map([
    ["native", { id: "native", agent: "build" }],
    ["chat", { id: "chat", agent: "chat/ingenium-chat" }],
    ["broker", { id: "broker", agent: "ingenium-llm-broker" }],
  ]);
  const prompts = [];
  const registration = { dispose: async () => {} };
  const hook = (collection) => async (name, callback) => {
    collection.set(name, [...collection.get(name) ?? [], callback]);
    return registration;
  };
  let sendEvent;
  const ctx = {
    options: { auto_continue: true, min_continue_interval_seconds: 0 },
    session: {
      get: async ({ sessionID }) => {
        if (!sessions.has(sessionID)) throw new Error("NOT_FOUND");
        return sessions.get(sessionID);
      },
      hook: hook(sessionHooks), context: async () => [],
      prompt: async (input) => { prompts.push(input); },
    },
    tool: {
      transform: async (transform) => { transform({ add: (tool) => tools.set(tool.name, tool) }); return registration; },
      hook: hook(toolHooks),
    },
    command: {
      list: async () => ({ data: [] }),
      transform: async (transform) => { transform({ add: (command) => commands.set(command.name, command) }); return registration; },
    },
    event: {
      async *subscribe({ signal }) {
        while (!signal.aborted) {
          const event = await new Promise((resolve) => {
            sendEvent = resolve;
            signal.addEventListener("abort", () => resolve(null), { once: true });
          });
          if (event) yield event;
        }
      },
    },
  };
  let cleanup;
  const execution = (sessionID, agent = sessions.get(sessionID)?.agent) => ({ sessionID, agent, id: "probe" });
  const call = (name, args, sessionID) => tools.get(name).execute(args, execution(sessionID));
  try {
    cleanup = await setupScopedGoals(ctx, upstream);
    assert.deepEqual(new Set(tools.keys()), GOAL_TOOLS);
    assert.deepEqual([...commands.keys()].sort(), ["goal", "pause_goal", "resume_goal"]);
    const created = JSON.parse((await call("create_goal", { objective: "Verify scoped goal persistence" }, "native")).content);
    assert.equal(created.goal.status, "active");
    assert.equal(JSON.parse((await call("get_goal", {}, "native")).content).goal.objective, "Verify scoped goal persistence");
    assert.ok((await readFile(process.env.OPENCODE_GOAL_STATE_PATH, "utf8")).includes("Verify scoped goal persistence"));
    await call("update_goal_status", { status: "paused" }, "native");
    assert.equal(JSON.parse((await call("get_goal", {}, "native")).content).goal.status, "paused");
    for (const sessionID of ["chat", "broker", "missing"]) {
      for (const name of GOAL_TOOLS) await assert.rejects(call(name, {}, sessionID), /GOALS_UNAVAILABLE/);
      for (const command of commands.values()) await assert.rejects(command.execute({ sessionID, prompt: { text: "test" } }), /GOALS_UNAVAILABLE/);
    }
    const native = { ...execution("native"), system: [], tools: Object.fromEntries([...tools.keys()].map((name) => [name, {}])) };
    for (const callback of sessionHooks.get("context")) await callback(native);
    assert.ok(native.system.some((part) => /goal/i.test(part.text)));
    assert.ok(native.tools.create_goal);
    for (const name of ["context", "generate", "compaction"]) {
      const chat = { ...execution("chat"), system: [], tools: { create_goal: {}, get_goal: {}, read: {} } };
      for (const callback of sessionHooks.get(name)) await callback(chat);
      assert.deepEqual(chat.system, []);
      assert.deepEqual(Object.keys(chat.tools), ["read"]);
    }
    await call("update_goal_status", { status: "active" }, "native");
    // A goal created in OpenCode must not follow the session into Chat mode.
    sessions.get("native").agent = "ingenium-chat";
    await assert.rejects(call("get_goal", {}, "native"), /GOALS_UNAVAILABLE/);
    sendEvent({ type: "session.idle", data: { sessionID: "native" } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(prompts.length, 0);
    let denials = 0;
    for (const callback of toolHooks.get("execute.before")) {
      try { await callback({ ...execution("chat"), tool: "create_goal" }); }
      catch (error) { denials++; assert.match(error.message, /GOALS_UNAVAILABLE/); }
    }
    assert.equal(denials, 1);
    assert.equal(excludedAgent("chat/ingenium-chat"), true);
    assert.equal(excludedAgent("ingenium-orchestrator"), false);
  } finally {
    await cleanup?.();
    await rm(root, { recursive: true, force: true });
    delete process.env.OPENCODE_GOAL_STATE_PATH;
  }
});
