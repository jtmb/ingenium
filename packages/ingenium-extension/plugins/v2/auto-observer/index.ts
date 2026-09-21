import { defineV2Plugin, type LegacyPluginFactory } from "../../../plugin-v2.js";
import { AutoObserverPlugin } from "../../../auto-observer.js";

export default defineV2Plugin({
  id: "ingenium-auto-observer",
  legacy: AutoObserverPlugin as unknown as LegacyPluginFactory,
});
