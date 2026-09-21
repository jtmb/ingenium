import { defineV2Plugin, type LegacyPluginFactory } from "../../../plugin-v2.js";
import { LifecyclePlugin } from "../../../lifecycle.js";

export default defineV2Plugin({
  id: "ingenium-lifecycle",
  legacy: LifecyclePlugin as unknown as LegacyPluginFactory,
});
