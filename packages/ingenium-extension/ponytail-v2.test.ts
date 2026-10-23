import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface CommandDefinition {
  name: string;
  description?: string;
  execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" | "queue" }) => Promise<void>;
}

interface SystemPart {
  type: "text";
  text: string;
}

let configHome: string;
let statePath: string;

beforeAll(() => {
  configHome = mkdtempSync(join(tmpdir(), "ponytail-v2-"));
  statePath = join(configHome, "opencode", ".ponytail-active");
  process.env.XDG_CONFIG_HOME = configHome;
});

afterAll(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(configHome, { recursive: true, force: true });
});

async function loadAdapter() {
  vi.resetModules();
  return (await import("./plugins/v2/ponytail/index.js")).default as unknown as {
    id: string;
    setup: (ctx: unknown) => Promise<void>;
  };
}

function fakeContext() {
  const commands: CommandDefinition[] = [];
  const skills: unknown[] = [];
  const hooks: Array<(event: { system: SystemPart[] }) => void> = [];
  const prompts: unknown[] = [];
  const context = {
    command: {
      transform: async (callback: (editor: { add: (command: CommandDefinition) => void }) => void) => {
        callback({ add: (command) => commands.push(command) });
      },
    },
    skill: {
      transform: async (callback: (editor: { add: (skill: unknown) => void }) => void) => {
        callback({ add: (skill) => skills.push(skill) });
      },
    },
    session: {
      hook: async (_name: string, callback: (event: { system: SystemPart[] }) => void) => {
        hooks.push(callback);
      },
      prompt: async (input: unknown) => {
        prompts.push(input);
      },
    },
  };
  return { context, commands, skills, hooks, prompts };
}

describe("ponytail V2 adapter", () => {
  it("registers the vendored commands and skills through V2 transforms", async () => {
    const adapter = await loadAdapter();
    const { context, commands, skills } = fakeContext();
    await adapter.setup(context);

    expect(adapter.id).toBe("ponytail");
    expect(commands.map((command) => command.name).sort()).toEqual([
      "ponytail",
      "ponytail-audit",
      "ponytail-debt",
      "ponytail-gain",
      "ponytail-help",
      "ponytail-review",
    ]);
    expect(skills).toHaveLength(6);
    expect((skills[0] as { content: string }).content.length).toBeGreaterThan(0);
  });

  it("persists the mode and prompts the session for /ponytail arguments", async () => {
    const adapter = await loadAdapter();
    const { context, commands, prompts } = fakeContext();
    await adapter.setup(context);

    const command = commands.find((entry) => entry.name === "ponytail");
    expect(command).toBeDefined();
    await command!.execute({ sessionID: "ses_1", prompt: { text: "ultra" }, delivery: "steer" });

    expect(readFileSync(statePath, "utf8")).toBe("ultra");
    expect(prompts).toHaveLength(1);
    const prompted = prompts[0] as { sessionID: string; text: string; delivery: string };
    expect(prompted.sessionID).toBe("ses_1");
    expect(prompted.text).toContain("ultra mode");
    expect(prompted.text).not.toContain("$ARGUMENTS");
  });

  it("injects the active ruleset and respects broker/off guards", async () => {
    const adapter = await loadAdapter();
    const { context, hooks } = fakeContext();
    await adapter.setup(context);

    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, "full");
    const injected: SystemPart[] = [];
    hooks[0]!({ system: injected });
    expect(injected).toHaveLength(1);
    expect(injected[0]!.text).toContain("PONYTAIL MODE ACTIVE");

    const broker: SystemPart[] = [{ type: "text", text: "This agent is reserved for system use. Do not invoke directly." }];
    hooks[0]!({ system: broker });
    expect(broker).toHaveLength(1);

    writeFileSync(statePath, "off");
    const disabled: SystemPart[] = [];
    hooks[0]!({ system: disabled });
    expect(disabled).toHaveLength(0);
  });
});
