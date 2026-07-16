"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "system" | "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" }>({ theme: "system", setTheme: () => {}, resolved: "light" });

export function useTheme() { return useContext(ThemeContext); }

/** Write the resolved theme to a cookie so the server can read it before render (prevents flash of wrong theme). */
function setThemeCookie(value: "light" | "dark") {
  try {
    document.cookie = `theme=${value}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

/**
 * Theme provider with three modes: light, dark, and system (follows OS preference).
 *
 * State machine:
 * - `theme` — user's declared preference (persisted to localStorage)
 * - `resolved` — the actual effective theme (light or dark) derived from theme + OS matchMedia
 *
 * Server-side: initialises to "system" + "light" (the SSR-safe default).
 * The cookie written on every change lets middleware/layout read the theme
 * before hydration, preventing a flash of the wrong theme on page load.
 *
 * When in "system" mode, a matchMedia listener keeps the theme in sync with
 * OS-level changes (e.g. switching macOS between light/dark mode).
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system"
    : ((localStorage.getItem("theme") as Theme | null) ?? "system"));
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light");

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      root.classList.add("dark");
      setResolved("dark");
      setThemeCookie("dark");
    } else {
      root.classList.remove("dark");
      setResolved("light");
      setThemeCookie("light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Listen for system-level colour scheme changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) { document.documentElement.classList.add("dark"); setResolved("dark"); setThemeCookie("dark"); }
      else { document.documentElement.classList.remove("dark"); setResolved("light"); setThemeCookie("light"); }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
