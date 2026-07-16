"use client";

import { usePathname } from "next/navigation";

interface OpenCodeFrameProps {
  mode: "web" | "cli";
  cliMounted: boolean;
}

/**
 * Renders two stable, full-size iframes for OpenCode Web and CLI modes.
 * Both iframes stay at full viewport dimensions in the DOM at all times
 * (once mounted). Inactive iframes are hidden via opacity/visibility/padding
 * instead of display:none to prevent xterm dimension zeroing on the CLI side.
 */
export default function OpenCodeFrame({ mode, cliMounted }: OpenCodeFrameProps) {
  const pathname = usePathname();
  const isOpenCode = pathname === "/opencode";

  if (!isOpenCode) return null;

  return (
    <div className="fixed inset-0 top-[57px]">
      {/* Web iframe — always mounted */}
      <iframe
        src="http://localhost:4098/"
        className="absolute inset-0 w-full h-full border-0"
        style={{
          opacity: mode === "web" ? 1 : 0,
          visibility: mode === "web" ? "visible" : "hidden",
          pointerEvents: mode === "web" ? "auto" : "none",
        }}
        aria-hidden={mode !== "web"}
        tabIndex={mode === "web" ? 0 : -1}
        title="OpenCode Web"
        allow="clipboard-write"
      />

      {/* CLI iframe — lazy-mounted on first CLI activation */}
      {cliMounted && (
        <iframe
          src="http://localhost:4099/"
          className="absolute inset-0 w-full h-full border-0"
          style={{
            opacity: mode === "cli" ? 1 : 0,
            visibility: mode === "cli" ? "visible" : "hidden",
            pointerEvents: mode === "cli" ? "auto" : "none",
          }}
          aria-hidden={mode !== "cli"}
          tabIndex={mode === "cli" ? 0 : -1}
          title="OpenCode Terminal"
          allow="clipboard-write"
        />
      )}
    </div>
  );
}
