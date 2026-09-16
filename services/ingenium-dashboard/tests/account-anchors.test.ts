import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
describe("account settings deep links", () => { it("exposes stable accessible account section targets", () => { const source = readFileSync(resolve(import.meta.dirname, "../src/app/account/page.tsx"), "utf8"); for (const id of ["security", "sessions", "api-tokens"]) { expect(source).toContain(`id="${id}"`); expect(source).toContain(`href="#${id}"`); } expect(source.match(/tabIndex=\{-1\}/g)?.length).toBe(3); }); });
