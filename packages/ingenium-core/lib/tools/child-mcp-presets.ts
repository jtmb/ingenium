import type { ChildMcpServerDefinitionInput } from "../schema.js";

export const PLAYWRIGHT_CHILD_MCP_VERSION = "0.0.78";
export const PLAYWRIGHT_CHILD_MCP_PACKAGE = `@playwright/mcp@${PLAYWRIGHT_CHILD_MCP_VERSION}`;
export const PLAYWRIGHT_CHILD_MCP_INTEGRITY = "sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ==";
export const PLAYWRIGHT_CHILD_MCP_EXECUTABLE = "/app/node_modules/.bin/playwright-mcp";
export const PLAYWRIGHT_CHILD_MCP_BROWSER_PATH = "/opt/ingenium-playwright/chromium";

export const PLAYWRIGHT_CHILD_MCP_ARGS = [
  "--headless",
  "--browser=chromium",
  "--executable-path",
  PLAYWRIGHT_CHILD_MCP_BROWSER_PATH,
  "--isolated",
  "--caps=vision",
  "--block-service-workers",
  "--output-mode=file",
  "--output-max-size=52428800",
] as const;

export const PLAYWRIGHT_CHILD_MCP_PASSIVE_TOOL_PERMISSIONS = [
  "ingenium_playwright_browser_close",
  "ingenium_playwright_browser_console_messages",
  "ingenium_playwright_browser_find",
  "ingenium_playwright_browser_navigate",
  "ingenium_playwright_browser_network_request",
  "ingenium_playwright_browser_network_requests",
  "ingenium_playwright_browser_resize",
  "ingenium_playwright_browser_snapshot",
  "ingenium_playwright_browser_tabs",
  "ingenium_playwright_browser_take_screenshot",
] as const;

export function playwrightChildMcpPreset(): ChildMcpServerDefinitionInput {
  return {
    name: "playwright",
    executable: PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
    args: [...PLAYWRIGHT_CHILD_MCP_ARGS],
    environment: {},
    scope: "project",
  };
}

export function isPlaywrightChildMcpPreset(
  definition: Pick<ChildMcpServerDefinitionInput, "name" | "executable" | "args" | "environment" | "scope">,
): boolean {
  return definition.name === "playwright"
    && definition.executable === PLAYWRIGHT_CHILD_MCP_EXECUTABLE
    && definition.scope === "project"
    && Object.keys(definition.environment).length === 0
    && definition.args.length === PLAYWRIGHT_CHILD_MCP_ARGS.length
    && definition.args.every((argument, index) => argument === PLAYWRIGHT_CHILD_MCP_ARGS[index]);
}
