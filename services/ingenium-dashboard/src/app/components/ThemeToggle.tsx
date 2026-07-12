"use client";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button onClick={() => setTheme(resolved === "dark" ? "light" : "dark")} className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:text-gray-400 dark:hover:text-gray-100" title="Toggle theme">
      {resolved === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
