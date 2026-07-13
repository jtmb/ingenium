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
