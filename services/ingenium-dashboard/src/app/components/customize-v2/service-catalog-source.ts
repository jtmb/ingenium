import { request } from "../../../lib/api";
import { createCatalogPageReader, type CatalogReadBinding } from "./catalog-reader.mjs";
import type { CustomizeCatalogSource } from "./CustomizeSurface";

/** Use only after the coordinator mounts the real catalog/auth authority. */
export function createServiceCatalogSource(binding: CatalogReadBinding): CustomizeCatalogSource {
  return {
    id: binding.selectorId ?? binding.visibility,
    scopeIdentity: binding.scopeIdentity,
    label: binding.label,
    apiProject: binding.apiProject,
    read: createCatalogPageReader(request, binding),
  };
}
