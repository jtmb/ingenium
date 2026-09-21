import { describe, expect, it, vi } from "vitest";
import type { TuiHostSlotMap, TuiPluginApi, TuiPluginModule, TuiSlotContext } from "@opencode-ai/plugin/tui";

// Inspect the native renderer contract without substituting a fake layout engine.
vi.mock("@opentui/solid/jsx-runtime", () => ({
  jsx: (type: string, props: Record<string, unknown>) => ({ type, props }),
}));

import * as module from "./plugins/session-id-tui.js";

type Node = { type: string; props: Record<string, unknown> & { children?: Node[] } };
type Sidebar = (context: TuiSlotContext, props: TuiHostSlotMap["sidebar_content"]) => unknown;

// Mirrors the V1 default-export contract, as in plugin-loader-v1-compat.test.ts.
function readTuiModule(mod: { default?: unknown }): TuiPluginModule {
  const value = mod.default;
  if (!value || typeof value !== "object" || !("id" in value)
    || typeof value.id !== "string" || !value.id.trim()
    || !("tui" in value) || typeof value.tui !== "function") {
    throw new TypeError("Expected a stable id and tui()");
  }
  if ("server" in value) throw new TypeError("Export either server() or tui(), not both");
  return value as TuiPluginModule;
}

async function sidebar() {
  const register = vi.fn((_plugin: { slots: { sidebar_content: Sidebar } }) => "ingenium-session-id");
  await module.default.tui({ slots: { register } } as unknown as TuiPluginApi);
  expect(register).toHaveBeenCalledOnce();
  const [registration] = register.mock.calls[0]!;
  expect(Object.keys(registration.slots)).toEqual(["sidebar_content"]);
  return registration.slots.sidebar_content;
}

describe("standalone session-ID TUI plugin", () => {
  it("accepts the standalone module and rejects mixed server/TUI modules", () => {
    expect(Object.keys(module)).toEqual(["default"]);
    expect(readTuiModule(module)).toBe(module.default);
    expect(Object.keys(module.default)).toEqual(["id", "tui"]);
    expect(() => readTuiModule({ default: { ...module.default, server: vi.fn() } }))
      .toThrow("not both");
    expect(() => readTuiModule({ default: { tui: vi.fn() } })).toThrow("stable id");
  });

  it("renders the exact slot ID and follows session changes without identity lookups", async () => {
    const render = await sidebar();
    const props = { session_id: "ses_Exact-Raw_ID_01aB9" };
    const tree = render({} as TuiSlotContext, props) as Node;
    const text = tree.props.children![1]!;
    expect(text.type).toBe("text");
    expect(text.props.content).toBe(props.session_id);
    props.session_id = "ses_Another_RAW_Id_02";
    expect(text.props.content).toBe(props.session_id);
    expect(tree.props.children![2]!.props.content).toContain("Use terminal selection");
    expect(tree.props.children![2]!.props.content).toContain("No clipboard action");
  });

  it("delegates narrow-width truncation to the viewport while retaining full content", async () => {
    const render = await sidebar();
    const session_id = `ses_${"0123456789AbCdEf".repeat(8)}`;
    const tree = render({} as TuiSlotContext, { session_id }) as Node;
    const text = tree.props.children![1]!;
    expect(tree.props.width).toBe("100%");
    expect(text.props).toMatchObject({
      width: "100%", minWidth: 0, wrapMode: "none", truncate: true, selectable: true,
    });
    expect(text.props.content).toBe(session_id);
    expect(tree.props.children![2]!.props.content).toContain("Widen the view first");
  });
});
