/**
 * Skill Taxonomy Validation Tests
 *
 * Validates the Phase 3 taxonomy consolidation (36 → 10 canonical skills) by checking:
 *   - Canonical SKILL.md count (10)
 *   - MIGRATED-TO.md marker count (28)
 *   - source-index.md preserved source count (28)
 *   - All canonical SKILL.md files have valid YAML frontmatter (name + description)
 *   - All MIGRATED-TO.md markers reference valid canonical targets
 *   - consolidation-map.json integrity (version, mappings, source/target consistency)
 *
 * Run:  npx vitest run tests/skill-taxonomy.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

// ── Constants ────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SKILLS_DIR = resolve(PROJECT_ROOT, ".opencode", "skills");

const EXPECTED_CANONICAL = 10;
const EXPECTED_MIGRATED = 28;
const EXPECTED_SOURCES = 28;
const CONSOLIDATION_MAP_VERSION = "1.0.0";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Recursively find files matching a name under a root directory. */
function findFiles(root: string, fileName: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, fileName));
      } else if (entry.name === fileName) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist — skip
  }
  return results;
}

/** Get immediate subdirectories of a path (non-recursive). */
function getSubdirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => resolve(root, e.name));
  } catch {
    return [];
  }
}

/** Extract YAML frontmatter fields from the string content. */
function parseFrontmatter(content: string): Record<string, string> {
  // Match YAML frontmatter delimited by ---
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const fields: Record<string, string> = {};

  // Simple YAML key-value pair extraction (handles quoted and unquoted values)
  const keyValRe = /^(\w[\w-]*)\s*:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = keyValRe.exec(yaml)) !== null) {
    let value = m[2].trim();
    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[m[1]] = value;
  }
  return fields;
}

/** Extract the target canonical skill name from a MIGRATED-TO.md file. */
function getMigratedTargetName(filePath: string): string | null {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/\*\*Canonical target\*\*:\s*`([^`]+)`/);
  return match ? match[1] : null;
}

// ══════════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════════

describe("Canonical SKILL.md files", () => {
  let canonicalFiles: string[];

  beforeAll(() => {
    // Collect SKILL.md files in top-level skill directories (exclude references/ subdirs)
    const allSkillMd = findFiles(SKILLS_DIR, "SKILL.md");
    canonicalFiles = allSkillMd.filter(f => !f.includes("/references/"));
    // Sort for deterministic ordering
    canonicalFiles.sort();
  });

  it(`finds exactly ${EXPECTED_CANONICAL} canonical SKILL.md files`, () => {
    expect(canonicalFiles).toHaveLength(EXPECTED_CANONICAL);
  });

  it("every canonical SKILL.md has valid YAML frontmatter with non-empty name", () => {
    for (const file of canonicalFiles) {
      const content = readFileSync(file, "utf-8");
      const fm = parseFrontmatter(content);

      expect(
        fm.name,
        `${file}: name field missing or empty in frontmatter`
      ).toBeTruthy();
      expect(
        fm.name.trim().length,
        `${file}: name field is non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it("every canonical SKILL.md has valid YAML frontmatter with non-empty description", () => {
    for (const file of canonicalFiles) {
      const content = readFileSync(file, "utf-8");
      const fm = parseFrontmatter(content);

      expect(
        fm.description,
        `${file}: description field missing in frontmatter`
      ).toBeTruthy();
      expect(
        fm.description.trim().length,
        `${file}: description field is non-empty (found: "${fm.description}")`
      ).toBeGreaterThan(0);
    }
  });

  it("canonical name matches the directory name", () => {
    for (const file of canonicalFiles) {
      const dirName = basename(resolve(file, ".."));
      const content = readFileSync(file, "utf-8");
      const fm = parseFrontmatter(content);

      expect(
        fm.name,
        `${file}: name field matches directory "${dirName}"`
      ).toBe(dirName);
    }
  });
});

describe("MIGRATED-TO.md markers", () => {
  let migratedFiles: string[];
  let canonicalNames: Set<string>;

  beforeAll(() => {
    migratedFiles = findFiles(SKILLS_DIR, "MIGRATED-TO.md");
    migratedFiles.sort();

    // Build canonical name set from SKILL.md frontmatter
    const canonicalFiles = findFiles(SKILLS_DIR, "SKILL.md").filter(
      f => !f.includes("/references/")
    );
    canonicalNames = new Set(
      canonicalFiles.map(f => {
        const fm = parseFrontmatter(readFileSync(f, "utf-8"));
        return fm.name;
      })
    );
  });

  it(`finds exactly ${EXPECTED_MIGRATED} MIGRATED-TO.md markers`, () => {
    expect(migratedFiles).toHaveLength(EXPECTED_MIGRATED);
  });

  it("every MIGRATED-TO.md references a valid canonical target", () => {
    for (const file of migratedFiles) {
      const target = getMigratedTargetName(file);
      const dirName = basename(resolve(file, ".."));

      expect(
        target,
        `${file}: "Canonical target" field not found in MIGRATED-TO.md`
      ).toBeTruthy();

      expect(
        canonicalNames.has(target!),
        `${file}: target "${target}" (from directory "${dirName}") is not in canonical set [${[...canonicalNames].join(", ")}]`
      ).toBe(true);
    }
  });

  it("every MIGRATED-TO.md directory name matches a consolidation-map source", () => {
    const mapPath = resolve(SKILLS_DIR, "consolidation-map.json");
    if (!existsSync(mapPath)) {
      // Skip if map doesn't exist — covered in separate test
      return;
    }
    const map = JSON.parse(readFileSync(mapPath, "utf-8"));
    const mapSources = new Set(
      (map.mappings as Array<{ source: string }>).map(m => m.source)
    );

    for (const file of migratedFiles) {
      const dirName = basename(resolve(file, ".."));
      expect(
        mapSources.has(dirName),
        `MIGRATED-TO.md directory "${dirName}" not found in consolidation-map.json mappings`
      ).toBe(true);
    }
  });
});

describe("source-index.md preserved sources", () => {
  let sourceFiles: string[];

  beforeAll(() => {
    sourceFiles = findFiles(SKILLS_DIR, "source-index.md");
    sourceFiles.sort();
  });

  it(`finds exactly ${EXPECTED_SOURCES} source-index.md preserved sources`, () => {
    expect(sourceFiles).toHaveLength(EXPECTED_SOURCES);
  });

  it("every source-index.md exists under a valid canonical target's references/sources/", () => {
    const canonicalDirs = new Set(
      getSubdirs(SKILLS_DIR)
        .filter(d => existsSync(resolve(d, "SKILL.md")))
        .map(d => basename(d))
    );

    for (const file of sourceFiles) {
      // path structure: .../skills/<canonical>/references/sources/<source>/source-index.md
      const parts = file.split("/");
      const skillsIdx = parts.indexOf("skills");
      expect(skillsIdx).toBeGreaterThan(-1);

      const canonicalDir = parts[skillsIdx + 1];
      expect(
        canonicalDirs.has(canonicalDir),
        `${file}: canonical parent "${canonicalDir}" is not a valid skill directory`
      ).toBe(true);

      // Verify the path structure is correct
      expect(parts[skillsIdx + 2]).toBe("references");
      expect(parts[skillsIdx + 3]).toBe("sources");

      // Source name should exist as a MIGRATED-TO.md directory
      const sourceName = parts[skillsIdx + 4];
      const migratedPath = resolve(
        SKILLS_DIR, sourceName, "MIGRATED-TO.md"
      );
      expect(
        existsSync(migratedPath),
        `${file}: no MIGRATED-TO.md marker found at ${migratedPath}`
      ).toBe(true);
    }
  });
});

describe("consolidation-map.json integrity", () => {
  let map: any;

  beforeAll(() => {
    const mapPath = resolve(SKILLS_DIR, "consolidation-map.json");
    expect(existsSync(mapPath), "consolidation-map.json must exist").toBe(true);
    map = JSON.parse(readFileSync(mapPath, "utf-8"));
  });

  it(`version is "${CONSOLIDATION_MAP_VERSION}"`, () => {
    expect(map.version).toBe(CONSOLIDATION_MAP_VERSION);
  });

  it(`has exactly ${EXPECTED_MIGRATED} mappings`, () => {
    expect(Array.isArray(map.mappings)).toBe(true);
    expect(map.mappings).toHaveLength(EXPECTED_MIGRATED);
  });

  it("all mapping target names are from the 10 canonical set", () => {
    const canonicalFiles = findFiles(SKILLS_DIR, "SKILL.md").filter(
      f => !f.includes("/references/")
    );
    const canonicalNames = new Set(
      canonicalFiles.map(f => {
        const fm = parseFrontmatter(readFileSync(f, "utf-8"));
        return fm.name;
      })
    );

    for (const mapping of map.mappings) {
      expect(
        canonicalNames.has(mapping.target),
        `Mapping target "${mapping.target}" (source: "${mapping.source}") not found in canonical set [${[...canonicalNames].join(", ")}]`
      ).toBe(true);
    }
  });

  it("all mapping source names correspond to existing MIGRATED-TO.md directories", () => {
    const migratedDirs = new Set(
      findFiles(SKILLS_DIR, "MIGRATED-TO.md").map(f => basename(resolve(f, "..")))
    );

    for (const mapping of map.mappings) {
      expect(
        migratedDirs.has(mapping.source),
        `Mapping source "${mapping.source}" has no corresponding MIGRATED-TO.md directory. Existing: [${[...migratedDirs].join(", ")}]`
      ).toBe(true);
    }
  });

  it("all sourcePath entries point to real files", () => {
    for (const mapping of map.mappings) {
      const fullPath = resolve(PROJECT_ROOT, mapping.sourcePath);
      expect(
        existsSync(fullPath),
        `sourcePath "${mapping.sourcePath}" (source: "${mapping.source}") does not exist at ${fullPath}`
      ).toBe(true);
    }
  });

  it("every mapping has required fields (source, target, sourcePath, sourceHash)", () => {
    for (const mapping of map.mappings) {
      expect(mapping.source).toBeTruthy();
      expect(mapping.target).toBeTruthy();
      expect(mapping.sourcePath).toBeTruthy();
      expect(mapping.sourceHash).toBeTruthy();
      // sourceHash should be 64-char SHA-256 hex
      expect(mapping.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("Cross-consistency checks", () => {
  it("MIGRATED-TO.md count equals source-index.md count", () => {
    const migratedCount = findFiles(SKILLS_DIR, "MIGRATED-TO.md").length;
    const sourceCount = findFiles(SKILLS_DIR, "source-index.md").length;
    expect(migratedCount).toBe(sourceCount);
  });

  it("MIGRATED-TO.md count equals consolidation-map mappings count", () => {
    const mapPath = resolve(SKILLS_DIR, "consolidation-map.json");
    if (!existsSync(mapPath)) return;
    const map = JSON.parse(readFileSync(mapPath, "utf-8"));
    const migratedCount = findFiles(SKILLS_DIR, "MIGRATED-TO.md").length;
    expect(migratedCount).toBe(map.mappings.length);
  });

  it("canonical skills listed in map match the 10 canonical directories", () => {
    const mapPath = resolve(SKILLS_DIR, "consolidation-map.json");
    if (!existsSync(mapPath)) return;
    const map = JSON.parse(readFileSync(mapPath, "utf-8"));
    const mapCanonical: string[] = map.canonicalSkills || [];
    expect(mapCanonical).toHaveLength(EXPECTED_CANONICAL);

    const canonicalDirs = getSubdirs(SKILLS_DIR)
      .filter(d => existsSync(resolve(d, "SKILL.md")))
      .map(d => basename(d));

    const mapCanonicalSet = new Set(mapCanonical);
    for (const dir of canonicalDirs) {
      expect(
        mapCanonicalSet.has(dir),
        `Directory "${dir}" has a SKILL.md but is not in consolidation-map.canonicalSkills`
      ).toBe(true);
    }
  });
});
