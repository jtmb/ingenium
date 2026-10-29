import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { getDb, getSkillsBase, projects, resetDbForTest, skills } from "ingenium-core";
import { createCustomizeService } from "../lib/customize-v2/catalog-service.js";
import { createProjectCatalogAuthority } from "../lib/customize-v2/project-authority.js";
import { readCatalogScope, resolveInstallationScope } from "../../ingenium-dashboard/src/app/components/customize-v2/catalog.mjs";

const outputRoot = process.env.VEYRA_CUSTOMIZE_OUTPUT_ROOT;

/**
 * Fixtures never start a subprocess/server/container or expose their randomized
 * directory outside this process. Close every SQLite handle before removal.
 */
describe.skipIf(!outputRoot)("Customize real SQLite and skill projection adapter", () => {
  let fixture = "";
  let ownedRoot = "";
  let installationId = "";
  let installationName = "";
  let localId = "";
  let marker = "";
  let fixtureProtected = false;
  const handles = new Set<ReturnType<typeof getDb>>();

  beforeEach(() => {
    if (fixtureProtected) throw new Error("A previous fixture is protected for failure evidence or after cleanup rejection; do not create further output.");
    if (process.platform !== "linux") throw new Error("Use the leased Linux runner for checked persistence fixture cleanup.");
    if (!outputRoot || !isAbsolute(outputRoot)) throw new Error("An assigned absolute Customize output root is required.");
    ownedRoot = realpathSync(outputRoot);
    fixture = mkdtempSync(join(ownedRoot, "persistence-"));
    marker = JSON.stringify({ owner: "veyra-customize-persistence", pid: process.pid, fixture,
      regeneration: "node node_modules/vitest/vitest.mjs run --config services/ingenium-api/tests/veyra-customize-vitest.config.ts tests/veyra-customize-persistence.test.ts" });
    writeFileSync(join(fixture, "owner.json"), marker);
    vi.stubEnv("INGENIUM_CORE_DB_PATH", join(fixture, "application", ".ingenium", "data"));
    vi.stubEnv("INGENIUM_HOME", join(fixture, "persistent-state"));
    vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(fixture, "global-config"));
    resetDbForTest();
    const installation = projects.createProject("explicit-customize-installation", true);
    installationId = installation.id;
    installationName = installation.name;
    localId = projects.createProject("customize-local").id;
    handles.add(getDb());
  });

  afterEach((context) => {
    if (fixtureProtected || !fixture) { vi.unstubAllEnvs(); return; }
    try {
      resetDbForTest();
      const closed = [...handles].every((handle) => !handle.open);
      handles.clear();
      vi.unstubAllEnvs();
      if (!fixture) return;
      const target = realpathSync(fixture);
      const retained = (reason: string): never => { fixtureProtected = true; throw new Error("Retained fixture " + target + ": " + reason); };
      if (!closed) retained("a fixture SQLite handle is still open");
      if (target === ownedRoot || !target.startsWith(ownedRoot + sep)) retained("ownership containment failed");
      if (readFileSync(join(target, "owner.json"), "utf8") !== marker) retained("ownership marker changed");
      const walk = (directory: string): number => readdirSync(directory).reduce((total, name) => {
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) retained("unexpected link or special file: " + path);
        if ([".git", "package-lock.json", "Cargo.lock", "pnpm-lock.yaml"].includes(name)) retained("source or lockfile found: " + path);
        if (relative(target, realpathSync(path)).startsWith(".." + sep)) retained("resolved fixture path escaped: " + path);
        return total + (stat.isDirectory() ? walk(path) : stat.size);
      }, 0);
      const bytes = walk(target);
      if (context.task.result?.state === "fail" || context.task.result?.errors?.length) {
        fixtureProtected = true;
        console.info(JSON.stringify({ cleanup: "retained", path: target, bytes, reason: "Unexpected test failure: coordinator diagnosis must consume this fixture before cleanup." }));
        return;
      }
      if (process.platform !== "linux") retained("mount/handle safety checks require the leased Linux runner");
      const mounts = readFileSync("/proc/self/mountinfo", "utf8").split("\n").map((line) => line.split(" ")[4]);
      if (mounts.some((path) => path === target || path?.startsWith(target + sep))) retained("fixture has an active mount");
      for (const fd of readdirSync("/proc/self/fd")) {
        let path: string;
        try { path = readlinkSync("/proc/self/fd/" + fd); } catch { continue; }
        if (path === target || path.startsWith(target + sep)) retained("fixture has an active process handle");
      }
      // This one-use private fixture was never shared or consumed by another process.
      rmSync(target, { recursive: true });
      console.info(JSON.stringify({ cleanup: "removed", path: target, bytes, regeneration: "veyra-customize-persistence.test.ts" }));
      fixture = "";
    } catch (error) {
      fixtureProtected = true;
      vi.unstubAllEnvs();
      throw new Error("Retained or incompletely removed fixture " + fixture + ": cleanup safety or removal failed.", { cause: error });
    }
  });

  function service() {
    return createCustomizeService(createProjectCatalogAuthority((context, action, kind, visibility) =>
      context.actorId === "fixture-owner" && context.projectId === installationId &&
      action === "read" && kind === "skill" && visibility === "project"));
  }

  function reopen() {
    handles.add(getDb());
    resetDbForTest();
    handles.add(getDb());
  }

  it("preserves installation skill identity, revision, references and namespace across DB reopen", async () => {
    const source = skills.createSkill(installationId, "phased-checkout-orchestration", "Fixture planning", "# Approval-gated planning", undefined, undefined, 0,
      JSON.stringify({ "references/approval.md": "Keep explicit approval." }));
    const mapping = resolveInstallationScope(projects.listProjects());
    expect(mapping).toEqual({ id: installationId, kind: "installation", label: "System", apiProject: installationName });
    const reader = { skills: { async list(name: string) {
      const project = projects.getProject(name);
      if (!project) throw new Error("Missing explicit source scope.");
      return { data: skills.listSkills(project.id) };
    } }, plugins: { async list() { return { data: [] }; } } };
    const before = await readCatalogScope(reader, mapping!, "skill");
    reopen();
    const after = await service().list({ actorId: "fixture-owner", projectId: installationId }, { kind: "skill" });
    expect(after.data[0]).toMatchObject({ id: source.id, installed: true, enabled: true, revision: source.revision });
    expect(before[0]).toMatchObject({ id: source.id, scope: "System", apiProject: installationName });
    expect(skills.listSkills(localId)).toEqual([]);
    expect(readFileSync(join(getSkillsBase(installationId), source.name, "SKILL.md"), "utf8")).toContain("# Approval-gated planning");
    expect(readFileSync(join(getSkillsBase(installationId), source.name, "references/approval.md"), "utf8")).toBe("Keep explicit approval.");
  });

  it("reads actual archive/restore state after DB reopen without changing another project", async () => {
    const original = skills.createSkill(installationId, "release-checks", "Installation", "# Original");
    const other = skills.createSkill(localId, "release-checks", "Local", "# Local stays unchanged");
    skills.updateSkill(installationId, original.name, "# Edited");
    skills.archiveSkill(installationId, original.name);
    reopen();
    expect((await service().list({ actorId: "fixture-owner", projectId: installationId }, { kind: "skill" })).data).toEqual([]);
    expect(skills.listArchivedSkills(installationId)[0]?.id).toBe(original.id);
    skills.restoreSkill(installationId, original.name);
    reopen();
    expect((await service().list({ actorId: "fixture-owner", projectId: installationId }, { kind: "skill" })).data[0]?.id).toBe(original.id);
    expect(readFileSync(join(getSkillsBase(installationId), original.name, "SKILL.md"), "utf8")).toContain("# Edited");
    expect(skills.getSkill(localId, other.name)?.content).toBe("# Local stays unchanged");
  });

  it("keeps projection failures out of the catalog and denies another actor before reads", async () => {
    const original = skills.createSkill(installationId, "retained-skill", "Retained", "# Retained");
    writeFileSync(join(getSkillsBase(installationId), "blocked-skill"), "Synthetic file blocks a directory.");
    expect(() => skills.createSkill(installationId, "blocked-skill", "Blocked", "# Must roll back")).toThrow();
    reopen();
    const result = await service().list({ actorId: "fixture-owner", projectId: installationId }, { kind: "skill" });
    expect(result.data.map((entry) => entry.id)).toEqual([original.id]);
    expect(skills.getSkill(installationId, "blocked-skill")).toBeUndefined();
    await expect(service().list({ actorId: "another-actor", projectId: installationId }, { kind: "skill" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service().list({ actorId: "fixture-owner", projectId: localId }, { kind: "skill" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("preserves actual disabled skill membership through an injected authoritative record reader", async () => {
    const original = skills.createSkill(installationId, "disabled-retained", "Retained", "# Retained",
      undefined, undefined, 0, JSON.stringify({ "references/keep.md": "Keep disabled source references." }));
    const disabled = skills.disableSkill(installationId, original.name)!;
    reopen();
    const authority = createProjectCatalogAuthority(
      (context, action, kind, visibility) => context.actorId === "fixture-owner" &&
        context.projectId === installationId && action === "read" && kind === "skill" && visibility === "project",
      (projectId) => {
        const row = skills.getSkill(projectId, original.name);
        return row ? [row] : [];
      },
    );
    const result = await createCustomizeService(authority).list({ actorId: "fixture-owner", projectId: installationId }, { kind: "skill" });
    expect(result.data[0]).toMatchObject({ id: original.id, installed: true, enabled: false, revision: disabled.revision });
    expect(skills.listSkills(installationId)).toEqual([]);
    expect(() => readFileSync(join(getSkillsBase(installationId), original.name, "SKILL.md"), "utf8")).toThrow();
    expect(readFileSync(join(getSkillsBase(installationId), original.name, "references/keep.md"), "utf8")).toBe("Keep disabled source references.");
  });
});
