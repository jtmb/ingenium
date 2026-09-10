import { test, expect } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";

const { dashboardUrl } = getDefaultSuiteRuntime();
const themeCookieUrl = new URL("/", dashboardUrl).toString();

function themeCookie(value: "light" | "dark") {
  // Playwright accepts either a URL or a domain/path pair, not both forms.
  return { name: "theme", value, url: themeCookieUrl };
}

test.describe("Theme flash prevention", () => {
  test("light-theme user on dark OS — class never flips to dark during load", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });

    // Playwright init scripts can run before <html> exists; set storage before
    // any optional DOM observation.
    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");

      (window as any).__classLog = [];
      const root = document.documentElement;
      if (root) {
        (window as any).__classLog.push(`initial: ${root.className}`);
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === "attributes" && m.attributeName === "class") {
              (window as any).__classLog.push(
                `mutated: ${(m.target as Element).className}`
              );
            }
          }
        });
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
      }
    });

    await page.context().addCookies([themeCookie("light")]);

    for (const path of ["/", "/mail", "/skills", "/observations"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const classLog: string[] = await page.evaluate(() => (window as any).__classLog ?? []);
      for (const entry of classLog) {
        expect(entry, `"dark" class appeared during ${path} load: ${entry}`).not.toContain("dark");
      }

      const finalClass = await page.evaluate(() => document.documentElement.className);
      expect(finalClass, `html className at ${path}`).not.toContain("dark");
    }
  });

  test("dark-theme user on dark OS — no white flash, dark class present from server render", async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.context().addCookies([themeCookie("dark")]);

    // SSR must emit the selected theme to prevent a first-paint flash.
    const resp = await page.request.get("/");
    const html = await resp.text();
    expect(html, "Server HTML must contain dark class").toMatch(/<html\b[^>]*class="[^"]*\bdark\b[^"]*"/);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const finalClass = await page.evaluate(() => document.documentElement.className);
    expect(finalClass).toContain("dark");
  });

  test("no-theme user on light OS — light by default, no dark flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });

    await page.addInitScript(() => {
      (window as any).__classLog = [];
      const root = document.documentElement;
      if (root) {
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === "attributes" && m.attributeName === "class") {
              (window as any).__classLog.push((m.target as Element).className);
            }
          }
        });
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const classLog: string[] = await page.evaluate(() => (window as any).__classLog ?? []);
    for (const entry of classLog) {
      expect(entry, `Unexpected dark class: ${entry}`).not.toContain("dark");
    }
  });
});

test.describe("Dark-mode computed style assertions", () => {
  test("computed colors match dark-mode CSS variables", async ({ page }) => {
    // Resolve the client theme before hydration so it agrees with the cookie.
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });

    await page.context().addCookies([themeCookie("dark")]);
    await page.goto("/skills");
    await expect(page.locator("nav").first()).toBeAttached();

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe("rgb(15, 15, 15)");

    const navBg = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return nav ? getComputedStyle(nav).backgroundColor : "";
    });
    expect(navBg).toBe("rgb(23, 23, 23)");

    const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bodyColor).toBe("rgb(229, 229, 229)");

    const navLink = await page.evaluate(() => {
      const link = document.querySelector("nav a");
      return link ? getComputedStyle(link).color : "";
    });
    expect(navLink).not.toBe("rgb(0, 0, 0)");
    expect(navLink).not.toBe("rgb(255, 255, 255)");
  });

  test("surface tokens resolve to neutral charcoal, not navy", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });

    await page.context().addCookies([themeCookie("dark")]);
    await page.goto("/skills");
    await expect(page.locator("nav").first()).toBeAttached();

    const navBg = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return nav ? getComputedStyle(nav).backgroundColor : "";
    });
    const rgb = navBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!rgb) throw new Error(`Unexpected nav bg: ${navBg}`);
    const [_, r, g, b] = rgb.map(Number);

    // Neutral charcoal keeps the RGB channels within a small spread.
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
    expect(maxDiff).toBeLessThanOrEqual(12); // max 12-point spread = neutral
  });
});
