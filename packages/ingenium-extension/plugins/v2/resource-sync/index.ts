import { defineV2Plugin, type LegacyPluginFactory } from "../../../plugin-v2.js";
import { ResourceSyncPlugin } from "../../../resource-sync.js";

export default defineV2Plugin({
  id: "ingenium-resource-sync",
  legacy: ResourceSyncPlugin as unknown as LegacyPluginFactory,
});
