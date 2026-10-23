import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/app/globals.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function palette(selector: string): Record<string, string> {
  return Object.fromEntries(
    [...css.matchAll(/(?:^|\n)(@theme|\.dark)\s*\{([^{}]*)\}/g)]
      .filter(([, scope]) => scope === selector)
      .flatMap(([, , declarations]) =>
        [...declarations.matchAll(/(--color-[\w-]+):\s*(#[\da-f]+);/gi)]
          .map(([, name, value]) => [name, value]),
      ),
  );
}

function composite(hex: string, backdrop = [0, 0, 0]): number[] {
  expect(hex).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/i);
  const alpha = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  return [1, 3, 5].map((offset, channel) =>
    parseInt(hex.slice(offset, offset + 2), 16) * alpha + backdrop[channel] * (1 - alpha),
  );
}

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const surfaces = [
  "--color-surface-muted",
  "--color-surface",
  "--color-surface-hover",
  "--color-surface-selected",
  "--color-selection-bg",
  "--color-surface-raised",
  "--color-nav-bg",
  "--color-code-bg",
];
const pairs = [
  ...["--color-text-muted", "--color-success-text", "--color-warning-text"]
    .flatMap((foreground) => surfaces.map((background) =>
      [foreground, background, "--color-surface-muted"],
    )),
  ...[
    ["--color-text-muted", "--color-info-bg"],
    ["--color-text-muted", "--color-error-bg"],
    ["--color-text-muted", "--color-warning-bg"],
    ["--color-text-muted", "--color-success-bg"],
    ["--color-success-text", "--color-success-bg"],
    ["--color-success-text", "--color-warning-bg"],
    ["--color-warning-text", "--color-warning-bg"],
  ].flatMap(([foreground, background]) => surfaces.map((backdrop) =>
    [foreground, background, backdrop],
  )),
];

it("keeps light/dark text and status controls at 4.5:1 and honors reduced motion", () => {
  const light = palette("@theme");
  const themes = { light, dark: { ...light, ...palette(".dark") } };

  for (const [theme, tokens] of Object.entries(themes)) {
    for (const [foreground, background, backdrop] of pairs) {
      const backgroundRgb = composite(tokens[background], composite(tokens[backdrop]));
      const backgroundLuminance = luminance(backgroundRgb);
      const foregroundLuminance = luminance(composite(tokens[foreground], backgroundRgb));
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      expect(ratio, `${theme}: ${foreground} on ${background} over ${backdrop}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }

  const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1];
  expect(reducedMotion).toBeDefined();
  const rules = [...reducedMotion!.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const motionPairs = [
    ...[".animate-pulse", ".animate-spin", ".animate-ping"].map((selector) => [selector, "animation"]),
    ...[
      ".desktop-navigation",
      ".desktop-navigation .desktop-nav-item",
      ".desktop-navigation .desktop-nav-group-control",
      ".desktop-navigation .nav-label",
      ".desktop-navigation .nav-badge",
      ".nav-group-items",
      ".mobile-navigation-drawer",
      ".edge-drawer-panel",
      ".edge-drawer-backdrop",
    ].map((selector) => [selector, "transition"]),
  ];
  for (const [selector, property] of motionPairs) {
    const rule = rules.find(([, selectors]) => selectors.split(",").map((value) => value.trim()).includes(selector));
    expect(rule?.[2], `${selector} reduced-motion ${property}`)
      .toMatch(new RegExp(`\\b${property}:\\s*none\\s*;`));
  }
});
