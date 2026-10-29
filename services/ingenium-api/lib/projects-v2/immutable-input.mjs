import {requireValue} from "../../../../packages/veyra-projects/domain.mjs";

export function immutableInput(value) {
  let copy;
  try { copy=structuredClone(value); }
  catch { requireValue(false); }
  const seen=new WeakSet();
  function freeze(item) {
    if (item===null || typeof item==="string" || typeof item==="boolean") return item;
    if (typeof item==="number") {requireValue(Number.isFinite(item));return item;}
    requireValue(item && typeof item==="object" && !seen.has(item));
    requireValue(Array.isArray(item) || Object.getPrototypeOf(item)===Object.prototype ||
      Object.getPrototypeOf(item)===null);
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    return Object.freeze(item);
  }
  return freeze(copy);
}
