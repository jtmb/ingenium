"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "system" | "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void; resolved: "light" | "dark" }>({ theme: "system", setTheme: () => {}, resolved: "light" });

export function useTheme() { return useContext(ThemeContext); }

/** Write the resolved theme to a cookie so the server can read it before render. */
function setThemeCookie(value: "light" | "dark") {
  try {
    document.cookie = `theme=${value}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) setThemeState(saved);
  }, []);

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

  // Listen for system changes when theme is "system"
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
