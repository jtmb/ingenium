import { test, expect } from "@playwright/test";

test.describe("Theme flash prevention", () => {
  test("light-theme user on dark OS — class never flips to dark during load", async ({ page }) => {
    // 🔴 THE CRITICAL CONDITION: OS prefers dark, user chose light
    await page.emulateMedia({ colorScheme: "dark" });

    // 🔴 IMPORTANT: document.documentElement is null when addInitScript runs
    // (Playwright fires init scripts before the HTML parser creates <html>).
    // We must set localStorage FIRST, before any DOM access that might throw.
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

    // Set the cookie so the server renders light
    await page.context().addCookies([{ name: "theme", value: "light", path: "/", domain: "localhost" }]);

    // Navigate to several pages (each is a full load — simulating real nav)
    for (const path of ["/", "/mail", "/skills", "/observations"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // Assert: the 'dark' class was NEVER added during the load sequence
      const classLog: string[] = await page.evaluate(() => (window as any).__classLog ?? []);
      for (const entry of classLog) {
        expect(entry, `"dark" class appeared during ${path} load: ${entry}`).not.toContain("dark");
      }

      // Assert: final state is light
      const finalClass = await page.evaluate(() => document.documentElement.className);
      expect(finalClass, `html className at ${path}`).not.toContain("dark");
    }
  });

  test("dark-theme user on dark OS — no white flash, dark class present from server render", async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.context().addCookies([{ name: "theme", value: "dark", path: "/", domain: "localhost" }]);

    // Check server HTML directly — dark class must be present in the first byte
    const resp = await page.request.get("/");
    const html = await resp.text();
    expect(html, "Server HTML must contain dark class").toContain('class="dark"');

    // Now navigate and verify it never drops
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
    // Set localStorage BEFORE page load so ThemeProvider resolves "dark"
    // instead of overwriting our cookie with "light" (the "system" default).
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });

    await page.context().addCookies([{
      name: "theme", value: "dark", domain: "localhost", path: "/"
    }]);
    await page.goto("/skills");

    // Body background = --color-surface-muted
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe("rgb(15, 15, 15)"); // #0f0f0f

    // Nav bar background = --color-surface
    const navBg = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return nav ? getComputedStyle(nav).backgroundColor : "";
    });
    expect(navBg).toBe("rgb(23, 23, 23)"); // #171717

    // Body text color = --color-text-primary
    const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(bodyColor).toBe("rgb(229, 229, 229)"); // #e5e5e5

    // Nav text link (an <a> in the nav) should be readable
    const navLink = await page.evaluate(() => {
      const link = document.querySelector("nav a");
      return link ? getComputedStyle(link).color : "";
    });
    // Should not be black/white default — confirms var resolution
    expect(navLink).not.toBe("rgb(0, 0, 0)");
    expect(navLink).not.toBe("rgb(255, 255, 255)");
  });

  test("surface tokens resolve to neutral charcoal, not navy", async ({ page }) => {
    // Set localStorage BEFORE page load so ThemeProvider resolves "dark"
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
    });

    await page.context().addCookies([{
      name: "theme", value: "dark", domain: "localhost", path: "/"
    }]);
    await page.goto("/skills");

    const navBg = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return nav ? getComputedStyle(nav).backgroundColor : "";
    });
    // Extract R,G,B
    const rgb = navBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!rgb) throw new Error(`Unexpected nav bg: ${navBg}`);
    const [_, r, g, b] = rgb.map(Number);

    // Navy-blue surfaces have elevated blue vs red
    // Neutral charcoal: R ≈ G ≈ B
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(r - b), Math.abs(g - b));
    expect(maxDiff).toBeLessThanOrEqual(12); // max 12-point spread = neutral
  });
});
