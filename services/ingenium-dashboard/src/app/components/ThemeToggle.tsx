"use client";
import { useTheme } from "./ThemeProvider";

/**
 * One-click theme toggle button.
 *
 * Cycles between the current resolved theme and its opposite.
 * `suppressHydrationWarning` is needed because the server renders "light"
 * (default) while the client may have a different resolved theme from
 * localStorage — without this, React would warn about the mismatch.
 */
export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button suppressHydrationWarning onClick={() => setTheme(resolved === "dark" ? "light" : "dark")} className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:text-gray-400 dark:hover:text-gray-100" title="Toggle theme">
      {resolved === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
