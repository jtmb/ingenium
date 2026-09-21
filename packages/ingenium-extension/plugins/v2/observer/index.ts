import { defineV2Plugin, type LegacyPluginFactory } from "../../../plugin-v2.js";
import { ObserverPlugin } from "../../../observer.js";

export default defineV2Plugin({
  id: "ingenium-observer",
  legacy: ObserverPlugin as unknown as LegacyPluginFactory,
});
