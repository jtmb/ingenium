import { pathToFileURL } from "node:url";
export async function resolve(specifier, context, nextResolve) {
  if(specifier === "express" && context.parentURL?.includes("/lib/dot-v2/router.ts") && process.env.VEYRA_DOT_TEST_EXPRESS) return nextResolve(pathToFileURL(process.env.VEYRA_DOT_TEST_EXPRESS).href,context);
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.endsWith(".js") || !context.parentURL?.includes("/lib/dot-v2/")) throw error;
    return nextResolve(specifier.slice(0,-3)+".ts", context);
  }
}
