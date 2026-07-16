"use client";

import { useEffect } from "react";

interface OpenCodeSwitchProps {
  mode: "web" | "cli";
  onModeChange: (newMode: "web" | "cli") => void;
}

/**
 * Right-edge glass tab that toggles between OpenCode Web and CLI modes.
 *
 * Resting: subtle (35% opacity, backdrop-blur-sm).
 * Hover/focus: mostly opaque (85% opacity, backdrop-blur-sm), expands left.
 *
 * Accessibility: role="button", aria-label describes destination,
 * aria-pressed reflects toggle state. Keyboard: Enter/Space to toggle;
 * global shortcut Ctrl+Shift+` toggles from anywhere on the page.
 */
export default function OpenCodeSwitch({ mode, onModeChange }: OpenCodeSwitchProps) {
  const isWeb = mode === "web";

  // Toggle handler
  const toggle = () => {
    onModeChange(isWeb ? "cli" : "web");
  };

  // Global keyboard shortcut: Ctrl+Shift+`
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "`") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const destinationLabel = isWeb ? "CLI" : "WEB";
  const ariaLabel = `Switch to ${isWeb ? "CLI" : "Web"} mode`;

  return (
    <>
      {/* Desktop: right-edge vertical glass tab */}
      <button
        type="button"
        role="button"
        aria-label={ariaLabel}
        aria-pressed={mode === "cli"}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={[
          // Base positioning — right edge, centered vertically
          "fixed right-0 top-1/2 -translate-y-1/2 z-40",
          // Visual
          "bg-[var(--color-surface)]/35 backdrop-blur-sm",
          "border border-[var(--color-border)] rounded-l-lg",
          // Size & content layout
          "w-10 h-[120px]",
          "flex flex-col items-center justify-center gap-1",
          // Text
          "text-[10px] font-semibold tracking-wider text-[var(--color-text-secondary)]",
          "leading-none",
          // Transitions
          "transition-all duration-300 ease-out",
          // Hover/focus states
          "hover:bg-[var(--color-surface)]/85 hover:shadow-[0_0_12px_rgba(59,130,246,0.15)] hover:-translate-x-6",
          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none",
          // Hide on mobile (mobile variant shown below)
          "hidden md:flex",
        ].join(" ")}
      >
        {/* Left-pointing chevron */}
        <svg
          className="w-3.5 h-3.5 text-[var(--color-text-secondary)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {/* Destination label (vertical text effect via narrow width) */}
        <span className="[writing-mode:vertical-rl] rotate-180">
          {destinationLabel}
        </span>
      </button>

      {/* Mobile: bottom-right pill */}
      <button
        type="button"
        role="button"
        aria-label={ariaLabel}
        aria-pressed={mode === "cli"}
        onClick={toggle}
        className={[
          "fixed bottom-4 right-4 z-40",
          "md:hidden",
          "flex items-center justify-center",
          "w-[30px] h-[30px] rounded-full",
          "bg-[var(--color-surface)]/35 backdrop-blur-sm",
          "border border-[var(--color-border)]",
          "text-[var(--color-text-secondary)]",
          "transition-all duration-300 ease-out",
          "hover:bg-[var(--color-surface)]/85 hover:shadow-[0_0_12px_rgba(59,130,246,0.15)]",
          "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none",
        ].join(" ")}
      >
        {/* Icon representing the OTHER mode */}
        {isWeb ? (
          /* Terminal icon (for switching TO CLI) */
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ) : (
          /* Globe icon (for switching TO Web) */
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        )}
      </button>
    </>
  );
}
