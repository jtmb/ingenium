import { defineV2Plugin, type LegacyPluginFactory } from "../../../plugin-v2.js";
import { LifecyclePlugin } from "../../../lifecycle.js";

// Single-session context upload and usage collection remain active.
// Coordinated parent recovery and multichat handoff tools are retired.
export default defineV2Plugin({
  id: "ingenium-lifecycle",
  legacy: LifecyclePlugin as unknown as LegacyPluginFactory,
});
