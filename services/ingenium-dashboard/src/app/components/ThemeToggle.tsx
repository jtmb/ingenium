"use client";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button onClick={() => setTheme(resolved === "dark" ? "light" : "dark")} className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" title="Toggle theme">
      {resolved === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
