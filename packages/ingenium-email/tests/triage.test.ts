import { afterEach, describe, expect, it } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

afterEach(() => {
  resetEmailRuntimeForTest();
});

describe("loadEmailSkills", () => {
  it("uses injected API-owned skill data and keeps only mail-relevant skills", async () => {
    const runtime = createMemoryEmailRuntime();
    runtime.skills.listSkills = () => [
      { name: "reply-template", content: "reply", category: "email" },
      { name: "priority-sender", content: "priority", tags: "email,sender:vip@example.test" },
      { name: "unrelated", content: "ignore", category: "general" },
    ];
    configureEmailRuntime(runtime);

    const { loadEmailSkills, loadHighPrioritySenders } = await import("../lib/triage.js");
    expect(loadEmailSkills("global-project").map((skill) => skill.name)).toEqual([
      "reply-template",
      "priority-sender",
    ]);
    expect(loadHighPrioritySenders("global-project")).toEqual([
      "sender:vip@example.test",
      "vip@example.test",
    ]);
  });
});
