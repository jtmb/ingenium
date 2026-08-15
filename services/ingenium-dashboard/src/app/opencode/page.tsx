import { parseOpenCodeMode } from "@/lib/open-code-mode";
import OpenCodePageClient from "./OpenCodePageClient";

/**
 * OpenCode page — dual-mode interface: Web, CLI.
 *
 * Renders iframe-based OpenCode interface with toolbar. Both iframes
 * persist in the DOM after first mount. The inactive iframe is hidden via
 * opacity/visibility/pointer-events instead of display:none to prevent
 * xterm dimension zeroing on the CLI side.
 *
 * Mode is persisted to localStorage under the `opencode-mode` key.
 * The legacy "chat" value is gracefully redirected to "web" since Chat
 * is now a standalone page at /chat.
 */
export default async function OpenCodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const modeParam = (await searchParams).mode;
  return <OpenCodePageClient
    initialMode={parseOpenCodeMode(typeof modeParam === "string" ? modeParam : null)}
    restoreStoredMode={modeParam === undefined}
  />;
}
