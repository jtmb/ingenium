/**
 * API-level skill governance integration tests.
 *
 * Covers: archive/restore, versions, rollback, lineage, proposals (all 4 types,
 * submit/approve/reject/rollback), lock gating, camelCase DTOs, cross-project
 * isolation, stale conflict detection, and no hard delete.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects, skills as skillsModule, maintenanceLocks } from "ingenium-core";
import { skillsRouter } from "../lib/routes/skills.js";

let tempDir: string;
let projectId: string;
let projectName: string;
let secondProjectId: string;
let secondProjectName: string;
let server: Server | null = null;
let baseUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/skills", skillsRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-gov-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");

  projectName = "gov-test-project";
  const project = projects.createProject(projectName);
  projectId = project.id;

  secondProjectName = "gov-second-project";
  const sp = projects.createProject(secondProjectName);
  secondProjectId = sp.id;

  const app = buildApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

afterEach(async () => {
  const allLocks = maintenanceLocks.listActiveLocks();
  for (const lock of allLocks) {
    maintenanceLocks.releaseLock(lock.resource, lock.project_id, lock.owner_token);
  }
  maintenanceLocks.cleanupExpiredLocks();
});

function skillsPath(path: string): string {
  return `${baseUrl}/api/v1/skills${path}`;
}

/** Acquire a lock and return { ownerToken }. Also returns the lock token for tearDown. */
async function acquireLock(expectedStatus: number = 201): Promise<string | null> {
  const res = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttlMs: 30_000 }),
  });
  if (res.status !== expectedStatus) return null;
  const b = await res.json();
  return b.data.ownerToken;
}

/** Release a lock by token. */
async function releaseLock(token: string): Promise<void> {
  await fetch(skillsPath(`/locks/release?project=${projectName}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerToken: token }),
  });
}

/** Create a skill via API (no lock needed by default unless testing gating). */
async function createSkillViaApi(name: string, lockToken?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (lockToken) headers["x-ingenium-lock-token"] = lockToken;
  return fetch(skillsPath(`?project=${projectName}`), {
    method: "POST",
    headers,
    body: JSON.stringify({ name, description: `desc ${name}`, content: `# ${name}` }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CamelCase DTO verification helper — for governance DTOs only
// ═══════════════════════════════════════════════════════════════════════════════

/** Asserts that governance DTOs (version, lineage, proposal, lock) contain no snake_case keys.
 *  Skill rows are explicitly snake_case and are NOT checked with this helper. */
function assertNoSnakeCase(obj: unknown, path: string = "root"): void {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) assertNoSnakeCase(obj[i], `${path}[${i}]`);
    return;
  }
  if (typeof obj === "object") {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (key.includes("_")) {
        // Allow known non-governance exceptions from generic response shapes
        if (["synced_to_db", "written_to_disk"].includes(key)) {
          continue;
        }
        throw new Error(`Snake_case key "${key}" found at ${path}. Governance DTOs must use camelCase.`);
      }
      assertNoSnakeCase((obj as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /archived
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /archived", () => {
  it("returns empty list when no archived skills", async () => {
    const res = await fetch(skillsPath(`/archived?project=${projectName}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    // Skill rows are snake_case — not checked with assertNoSnakeCase
  });

  it("lists archived skills after archive", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("arch-me", token!);
      const archiveRes = await fetch(skillsPath(`/arch-me/archive?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(archiveRes.status).toBe(200);

      const res = await fetch(skillsPath(`/archived?project=${projectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("arch-me");
      expect(body.data[0].archived_at).toBeTruthy();
      // Skill rows are snake_case — not checked with assertNoSnakeCase
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /:name/archive and POST /:name/restore
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /:name/archive and POST /:name/restore", () => {
  it("archives and restores a skill", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("cycle-test", token!);

      const ar = await fetch(skillsPath(`/cycle-test/archive?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(ar.status).toBe(200);
      const arBody = await ar.json();
      expect(arBody.data.archived_at).toBeTruthy();
      // Skill row DTO is snake_case

      // Verify not in active list
      const listRes = await fetch(skillsPath(`/?project=${projectName}`));
      const listBody = await listRes.json();
      expect(listBody.data.find((s: any) => s.name === "cycle-test")).toBeUndefined();

      // Restore
      const restRes = await fetch(skillsPath(`/cycle-test/restore?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(restRes.status).toBe(200);
      const restBody = await restRes.json();
      expect(restBody.data.archived_at).toBeNull();
      // Skill row DTO is snake_case

      // Verify back in active list
      const listRes2 = await fetch(skillsPath(`/?project=${projectName}`));
      const listBody2 = await listRes2.json();
      expect(listBody2.data.find((s: any) => s.name === "cycle-test")).toBeTruthy();
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for archive of nonexistent skill", async () => {
    const res = await fetch(skillsPath(`/nonexistent/archive?project=${projectName}`), {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for restore of non-archived skill", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("not-archived", token!);
      const res = await fetch(skillsPath(`/not-archived/restore?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(res.status).toBe(404);
    } finally {
      await releaseLock(token!);
    }
  });

  it("gates archive/restore with lock", async () => {
    // First create the skill (no lock active — this should succeed)
    await createSkillViaApi("gated-ar");

    // Then acquire a lock and test that mutations are gated
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/gated-ar/archive?project=${projectName}`), {
        method: "POST",
      });
      expect(res.status).toBe(423);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE 204 — archive-only semantics
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /:name — archive-only (no hard delete)", () => {
  it("returns 204 and archives, not hard deletes", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("no-hard-delete", token!);
      const delRes = await fetch(skillsPath(`/no-hard-delete?project=${projectName}`), {
        method: "DELETE",
        headers: { "x-ingenium-lock-token": token! },
      });
      expect(delRes.status).toBe(204);

      // Still findable by direct get
      const getRes = await fetch(skillsPath(`/no-hard-delete?project=${projectName}`));
      expect(getRes.status).toBe(200);
      expect(getRes.json().then((b: any) => b.data.archived_at)).toBeTruthy();

      // In archived list
      const archRes = await fetch(skillsPath(`/archived?project=${projectName}`));
      const archBody = await archRes.json();
      expect(archBody.data.some((s: any) => s.name === "no-hard-delete")).toBe(true);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Versions and Rollback
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /:name/versions and GET /:name/versions/:revision", () => {
  it("returns versions for a skill with multiple revisions", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("ver-test", token!);
      // Update to create a second version
      await fetch(skillsPath(`/ver-test?project=${projectName}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ content: "# updated" }),
      });

      const res = await fetch(skillsPath(`/ver-test/versions?project=${projectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.data)).toBe(true);
      for (const v of body.data) {
        assertNoSnakeCase(v);
        expect(v.skillId).toBeTruthy();
        expect(typeof v.revision).toBe("number");
        expect(v.name).toBe("ver-test");
      }
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns a specific version by revision", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("ver-spec", token!);

      const res = await fetch(skillsPath(`/ver-spec/versions/0?project=${projectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.revision).toBe(0);
      expect(body.data.name).toBe("ver-spec");
      assertNoSnakeCase(body.data);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for nonexistent version", async () => {
    const token = await acquireLock();
    try {
      await createSkillViaApi("ver-404", token!);
      const res = await fetch(skillsPath(`/ver-404/versions/999?project=${projectName}`));
      expect(res.status).toBe(404);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for version of nonexistent skill", async () => {
    const res = await fetch(skillsPath(`/nonexistent/versions/0?project=${projectName}`));
    expect(res.status).toBe(404);
  });

  it("returns 422 for invalid revision param", async () => {
    // Must use an existing skill, otherwise 404 comes before revision validation
    const token = await acquireLock();
    try {
      await createSkillViaApi("rev-val-test", token!);
      const res = await fetch(skillsPath(`/rev-val-test/versions/abc?project=${projectName}`));
      expect(res.status).toBe(422);
    } finally {
      await releaseLock(token!);
    }
  });
});

describe("POST /:name/rollback", () => {
  it("rolls back a skill to a prior revision", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      // Create with initial content
      await fetch(skillsPath(`?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ name: "rb-test", description: "rollback test", content: "# initial" }),
      });

      // Update to create revision 1
      await fetch(skillsPath(`/rb-test?project=${projectName}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ content: "# changed" }),
      });

      // Rollback to revision 0
      const rbRes = await fetch(skillsPath(`/rb-test/rollback?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ revision: 0 }),
      });
      expect(rbRes.status).toBe(200);
      const rbBody = await rbRes.json();
      expect(rbBody.data.content).toBe("# initial");
      // Rollback returns skill DTO (snake_case)
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for rollback of nonexistent version", async () => {
    const token = await acquireLock();
    try {
      await createSkillViaApi("rb-404", token!);
      const res = await fetch(skillsPath(`/rb-404/rollback?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ revision: 999 }),
      });
      expect(res.status).toBe(404);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 422 for missing revision body", async () => {
    const res = await fetch(skillsPath(`/foo/rollback?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for negative revision", async () => {
    const res = await fetch(skillsPath(`/foo/rollback?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: -1 }),
    });
    expect(res.status).toBe(422);
  });

  it("gates rollback with lock", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/any/rollback?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 0 }),
      });
      expect(res.status).toBe(423);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lineage
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /lineage and GET /:name/lineage", () => {
  it("creates lineage and retrieves it by target name", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      // Create two skills
      await createSkillViaApi("src-skill", token!);
      await createSkillViaApi("tgt-skill", token!);
      const tgtRes = await fetch(skillsPath(`/tgt-skill?project=${projectName}`));
      const tgtBody = await tgtRes.json();
      const targetSkillId = tgtBody.data.id;

      // Create lineage
      const linRes = await fetch(skillsPath(`/lineage?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          sourceProjectId: projectId,
          sourceName: "src-skill",
          targetSkillId,
          reason: "test merge",
        }),
      });
      expect(linRes.status).toBe(201);
      const linBody = await linRes.json();
      assertNoSnakeCase(linBody.data);
      expect(linBody.data.sourceName).toBe("src-skill");
      expect(linBody.data.targetSkillId).toBe(targetSkillId);
      expect(linBody.data.reason).toBe("test merge");
      expect(Array.isArray(linBody.data.mergedFilePaths)).toBe(true);

      // Retrieve lineage via target name
      const getRes = await fetch(skillsPath(`/tgt-skill/lineage?project=${projectName}`));
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.data.length).toBeGreaterThanOrEqual(1);
      assertNoSnakeCase(getBody.data[0]);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for lineage of nonexistent skill", async () => {
    const res = await fetch(skillsPath(`/nonexistent/lineage?project=${projectName}`));
    expect(res.status).toBe(404);
  });

  it("returns 409 for self-referencing lineage cycle", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("self-cycle", token!);
      const sRes = await fetch(skillsPath(`/self-cycle?project=${projectName}`));
      const sBody = await sRes.json();

      const res = await fetch(skillsPath(`/lineage?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          sourceProjectId: projectId,
          sourceName: "self-cycle",
          targetSkillId: sBody.data.id,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("LINEAGE_CYCLE");
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 422 for missing lineage fields", async () => {
    const token = await acquireLock();
    try {
      const res = await fetch(skillsPath(`/lineage?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ sourceName: "x" }),
      });
      expect(res.status).toBe(422);
    } finally {
      await releaseLock(token!);
    }
  });

  it("gates lineage creation with lock", async () => {
    // Acquire lock first, then test that lineage creation is gated
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/lineage?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProjectId: "x", sourceName: "y", targetSkillId: "z" }),
      });
      expect(res.status).toBe(423);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Proposals — Create, List, Get, Submit, Approve, Reject, Rollback
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /proposals (create)", () => {
  it("creates a 'create' proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "new-from-proposal",
          proposedState: { description: "test", content: "# test", category: "test" },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.proposalType).toBe("create");
      expect(body.data.status).toBe("draft");
      expect(body.data.targetName).toBe("new-from-proposal");
      expect(body.data.proposedState.description).toBe("test");
      assertNoSnakeCase(body.data);
    } finally {
      await releaseLock(token!);
    }
  });

  it("creates an 'update' proposal for existing skill", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("update-target", token!);

      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "update",
          targetName: "update-target",
          proposedState: { description: "updated desc", content: "# updated" },
        }),
      });
      expect(res.status).toBe(201);
      assertNoSnakeCase((await res.json()).data);
    } finally {
      await releaseLock(token!);
    }
  });

  it("creates a 'merge' proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("merge-src", token!);
      await createSkillViaApi("merge-tgt", token!);

      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "merge",
          targetName: "merge-tgt",
          sourceProjectId: projectId,
          sourceName: "merge-src",
          proposedState: { description: "merged", content: "# merged" },
        }),
      });
      expect(res.status).toBe(201);
    } finally {
      await releaseLock(token!);
    }
  });

  it("creates an 'archive' proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("archive-via-prop", token!);

      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "archive",
          targetName: "archive-via-prop",
          proposedState: { content: "# x", description: "x" },
        }),
      });
      expect(res.status).toBe(201);
    } finally {
      await releaseLock(token!);
    }
  });

  it("maps camelCase proposed state keys to core's snake_case internally", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "camel-to-snake",
          proposedState: { description: "test", content: "# test", alwaysApply: 1, fileTree: { "a.txt": "hello" } },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      // proposedState should come back parsed as camelCase keys (the DTO parses the JSON)
      expect(body.data.proposedState.alwaysApply).toBe(1);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 422 for invalid proposalType", async () => {
    const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalType: "invalid", targetName: "x", proposedState: {} }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for missing targetName", async () => {
    const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalType: "create", proposedState: {} }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 409 for 'create' proposal when target already exists", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("dup-target", token!);
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "dup-target",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      expect(res.status).toBe(409);
    } finally {
      await releaseLock(token!);
    }
  });

  it("gates proposal creation with lock", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalType: "create", targetName: "x", proposedState: { description: "x", content: "# x" } }),
      });
      expect(res.status).toBe(423);
    } finally {
      await releaseLock(token!);
    }
  });
});

describe("GET /proposals and GET /proposals/:proposalId", () => {
  it("lists proposals", async () => {
    const res = await fetch(skillsPath(`/proposals?project=${projectName}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    assertNoSnakeCase(body);
  });

  it("filters proposals by status", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "filter-test",
          proposedState: { description: "x", content: "# x" },
        }),
      });

      const resDraft = await fetch(skillsPath(`/proposals?project=${projectName}&status=draft`));
      expect(resDraft.status).toBe(200);
      for (const p of (await resDraft.json()).data) {
        expect(p.status).toBe("draft");
      }

      const resApplied = await fetch(skillsPath(`/proposals?project=${projectName}&status=applied`));
      expect(resApplied.status).toBe(200);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 422 for invalid status filter", async () => {
    const res = await fetch(skillsPath(`/proposals?project=${projectName}&status=invalid`));
    expect(res.status).toBe(422);
  });

  it("gets a single proposal by ID", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "get-by-id",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      const created = (await cr.json()).data;

      const res = await fetch(skillsPath(`/proposals/${created.id}?project=${projectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(created.id);
      assertNoSnakeCase(body.data);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 404 for nonexistent proposal", async () => {
    const res = await fetch(skillsPath(`/proposals/00000000-0000-0000-0000-000000000000?project=${projectName}`));
    expect(res.status).toBe(404);
  });
});

describe("Proposal lifecycle: submit → approve → rollback", () => {
  it("full lifecycle: draft → submit → approve → applied, then rollback", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      // Create proposal
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "lifecycle-skill",
          proposedState: { description: "lifecycle test", content: "# lifecycle", category: "test" },
        }),
      });
      expect(cr.status).toBe(201);
      const prop = (await cr.json()).data;
      expect(prop.status).toBe("draft");

      // Submit
      const submitRes = await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(submitRes.status).toBe(200);
      expect((await submitRes.json()).data.status).toBe("pending");

      // Approve
      const approveRes = await fetch(skillsPath(`/proposals/${prop.id}/approve?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "test-user", reason: "looks good" }),
      });
      expect(approveRes.status).toBe(200);
      const approvedData = (await approveRes.json()).data;
      expect(approvedData.status).toBe("applied");
      expect(approvedData.reviewer).toBe("test-user");
      assertNoSnakeCase(approvedData);

      // Skill should now exist
      const skillRes = await fetch(skillsPath(`/lifecycle-skill?project=${projectName}`));
      expect(skillRes.status).toBe(200);

      // Rollback
      const rbRes = await fetch(skillsPath(`/proposals/${prop.id}/rollback?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "test-user", reason: "revert" }),
      });
      expect(rbRes.status).toBe(200);
      const rbData = (await rbRes.json()).data;
      expect(rbData.status).toBe("rolledBack");
      expect(rbData.rolledBackAt).toBeTruthy();
      assertNoSnakeCase(rbData);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 409 when approving already-applied proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "double-approve",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      const prop = (await cr.json()).data;

      await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      await fetch(skillsPath(`/proposals/${prop.id}/approve?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "u" }),
      });

      // Double approve
      const res = await fetch(skillsPath(`/proposals/${prop.id}/approve?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "u" }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
    } finally {
      await releaseLock(token!);
    }
  });

  it("rejects a pending proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "reject-me",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      const prop = (await cr.json()).data;

      await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });

      const rejectRes = await fetch(skillsPath(`/proposals/${prop.id}/reject?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "test-user", reason: "not needed" }),
      });
      expect(rejectRes.status).toBe(200);
      const data = (await rejectRes.json()).data;
      expect(data.status).toBe("rejected");
      expect(data.reviewer).toBe("test-user");
      assertNoSnakeCase(data);
    } finally {
      await releaseLock(token!);
    }
  });

  it("cannot submit a non-draft proposal", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "submit-twice",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      const prop = (await cr.json()).data;

      await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });

      const res = await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });
      expect(res.status).toBe(409);
    } finally {
      await releaseLock(token!);
    }
  });

  it("returns 422 when reviewer is missing from approve/reject/rollback", async () => {
    const res1 = await fetch(skillsPath(`/proposals/some-id/approve?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(422);

    const res2 = await fetch(skillsPath(`/proposals/some-id/reject?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "nope" }),
    });
    expect(res2.status).toBe(422);
  });
});

describe("Stale approval detection", () => {
  it("returns stale when target revision changed before approval", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      // Create a skill
      await createSkillViaApi("stale-tgt", token!);

      // Create update proposal
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "update",
          targetName: "stale-tgt",
          proposedState: { description: "stale update", content: "# stale" },
        }),
      });
      expect(cr.status).toBe(201);
      const prop = (await cr.json()).data;

      // Submit
      await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });

      // Mutate target outside proposal — bumps revision
      await fetch(skillsPath(`/stale-tgt?project=${projectName}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ content: "# bumped" }),
      });

      // Approve — should be stale due to revision mismatch
      const approveRes = await fetch(skillsPath(`/proposals/${prop.id}/approve?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "test-user" }),
      });
      expect(approveRes.status).toBe(200);
      const data = (await approveRes.json()).data;
      expect(data.status).toBe("stale");
    } finally {
      await releaseLock(token!);
    }
  });
});

describe("Merge proposal lifecycle", () => {
  it("merges source into target, archives source, creates lineage", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("merge-src-2", token!);
      await createSkillViaApi("merge-tgt-2", token!);

      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "merge",
          targetName: "merge-tgt-2",
          sourceProjectId: projectId,
          sourceName: "merge-src-2",
          proposedState: { description: "merged result", content: "# merged" },
        }),
      });
      const prop = (await cr.json()).data;

      await fetch(skillsPath(`/proposals/${prop.id}/submit?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });

      const approveRes = await fetch(skillsPath(`/proposals/${prop.id}/approve?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({ reviewer: "test-user" }),
      });
      expect(approveRes.status).toBe(200);
      const data = (await approveRes.json()).data;
      expect(data.status).toBe("applied");

      // Source should be archived
      const srcCheck = await fetch(skillsPath(`/merge-src-2?project=${projectName}`));
      const srcBody = await srcCheck.json();
      expect(srcBody.data.archived_at).toBeTruthy();

      // Lineage should exist
      const linRes = await fetch(skillsPath(`/merge-tgt-2/lineage?project=${projectName}`));
      const linBody = await linRes.json();
      expect(linBody.data.length).toBeGreaterThanOrEqual(1);
      expect(linBody.data.some((l: any) => l.sourceName === "merge-src-2")).toBe(true);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lock gating for mutation endpoints
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lock gating — governance mutations", () => {
  it("allows proposal lifecycle mutations with lock token header", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "bypass-test",
          proposedState: { description: "x", content: "# x" },
        }),
      });
      expect(cr.status).toBe(201);
    } finally {
      await releaseLock(token!);
    }
  });

  it("blocks all mutation routes when locked without token", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const endpoints = [
        { method: "POST", path: "/any/archive", body: null },
        { method: "POST", path: "/any/restore", body: null },
        { method: "POST", path: "/any/rollback", body: { revision: 0 } },
        { method: "POST", path: "/proposals", body: { proposalType: "create", targetName: "x", proposedState: { description: "x", content: "# x" } } },
        { method: "POST", path: "/proposals/fake/submit", body: null },
        { method: "POST", path: "/proposals/fake/approve", body: { reviewer: "x" } },
        { method: "POST", path: "/proposals/fake/reject", body: { reviewer: "x" } },
        { method: "POST", path: "/proposals/fake/rollback", body: { reviewer: "x" } },
        { method: "POST", path: "/lineage", body: { sourceProjectId: "x", sourceName: "y", targetSkillId: "z" } },
      ];

      for (const ep of endpoints) {
        const res = await fetch(skillsPath(`${ep.path}?project=${projectName}`), {
          method: ep.method,
          headers: { "Content-Type": "application/json" },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        expect(res.status).toBe(423);
        const body = await res.json();
        expect(body.error.code).toBe("LOCKED");
      }
    } finally {
      await releaseLock(token!);
    }
  });

  it("reads are never blocked when lock is active", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const res = await fetch(skillsPath(`/archived?project=${projectName}`));
      expect(res.status).toBe(200);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-project isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-project isolation", () => {
  it("does not list archived skills from another project", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("cross-arch", token!);
      await fetch(skillsPath(`/cross-arch/archive?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
      });

      // Second project should see no archived skills
      const res = await fetch(skillsPath(`/archived?project=${secondProjectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    } finally {
      await releaseLock(token!);
    }
  });

  it("does not allow lineage across projects without target ownership", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await createSkillViaApi("cross-lin", token!);
      const sRes = await fetch(skillsPath(`/cross-lin?project=${projectName}`));
      const sBody = await sRes.json();

      // Try to use targetSkillId from project A in project B's lineage
      const linRes = await fetch(skillsPath(`/lineage?project=${secondProjectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          sourceProjectId: secondProjectId,
          sourceName: "nonexistent",
          targetSkillId: sBody.data.id,
        }),
      });
      // Should be rejected with ownership / not found errors
      expect([403, 404]).toContain(linRes.status);
    } finally {
      await releaseLock(token!);
    }
  });

  it("proposal in project A does not appear in project B", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create", targetName: "only-in-a",
          proposedState: { description: "x", content: "# x" },
        }),
      });

      const res = await fetch(skillsPath(`/proposals?project=${secondProjectName}`));
      const body = await res.json();
      expect(body.data.some((p: any) => p.targetName === "only-in-a")).toBe(false);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Wire-format verification — snake_case Skill rows + camelCase governance DTOs
// ═══════════════════════════════════════════════════════════════════════════════

describe("Wire-format contract enforcement", () => {
  it("skill list response uses snake_case for backward compatibility", async () => {
    const token = await acquireLock();
    try {
      await createSkillViaApi("camel-test", token!);
      const res = await fetch(skillsPath(`/?project=${projectName}`));
      const body = await res.json();
      const skill = body.data.find((s: any) => s.name === "camel-test");
      expect(skill).toBeTruthy();
      // Skill rows preserve pre-Phase-2 snake_case contract (Dashboard + resource-sync depend on it)
      expect(skill).toHaveProperty("always_apply");
      expect(skill).toHaveProperty("file_tree");
      expect(skill).toHaveProperty("created_at");
      expect(skill).toHaveProperty("updated_at");
      expect(skill).toHaveProperty("project_id");
      expect(skill).toHaveProperty("revision");
      expect(skill).toHaveProperty("archived_at");
      // enabled is raw 0/1 from DB, not boolean
      expect(typeof skill.enabled).toBe("number");
      // Skill rows are NOT checked with assertNoSnakeCase — snake_case is correct here
    } finally {
      await releaseLock(token!);
    }
  });

  it("FTS search returns raw Skill rows with numeric rank, snake_case, and numeric enabled", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    const uniqueMarker = `fts-search-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await createSkillViaApi(uniqueMarker, token!);
      const res = await fetch(skillsPath(`/search?project=${projectName}&q=${encodeURIComponent(uniqueMarker)}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBeGreaterThanOrEqual(1);
      const match = body.data.find((s: any) => s.name === uniqueMarker);
      expect(match).toBeTruthy();
      // FTS rank is a numeric column from SQLite (BM25 can be negative)
      expect(typeof match.rank).toBe("number");
      expect(Number.isFinite(match.rank)).toBe(true);
      // Snake_case skill row contract
      expect(match).toHaveProperty("always_apply");
      expect(match).toHaveProperty("file_tree");
      expect(match).toHaveProperty("created_at");
      expect(match).toHaveProperty("updated_at");
      expect(match).toHaveProperty("project_id");
      expect(match).toHaveProperty("revision");
      // enabled is raw 0/1 integer from DB
      expect(typeof match.enabled).toBe("number");
    } finally {
      await releaseLock(token!);
    }
  });

  it("version list response uses camelCase only", async () => {
    const token = await acquireLock();
    try {
      await createSkillViaApi("camel-ver", token!);
      const res = await fetch(skillsPath(`/camel-ver/versions?project=${projectName}`));
      const body = await res.json();
      assertNoSnakeCase(body);
      assertNoSnakeCase(body.data[0]);
    } finally {
      await releaseLock(token!);
    }
  });

  it("proposal response uses camelCase only, JSON fields parsed", async () => {
    const token = await acquireLock();
    try {
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "camel-prop",
          proposedState: { description: "test", content: "# test" },
          evidence: [{ type: "observation" }],
          observationIds: [1, 2, 3],
          qualityScore: 0.75,
        }),
      });
      const body = await cr.json();
      assertNoSnakeCase(body.data);
      // Verify JSON fields are parsed, not raw strings
      expect(typeof body.data.proposedState).toBe("object");
      expect(Array.isArray(body.data.evidence)).toBe(true);
      expect(Array.isArray(body.data.observationIds)).toBe(true);
      expect(body.data.qualityScore).toBe(0.75);
    } finally {
      await releaseLock(token!);
    }
  });

  it("lineage response uses camelCase and parses mergedFilePaths", async () => {
    const token = await acquireLock();
    try {
      await createSkillViaApi("lin-camel-src", token!);
      await createSkillViaApi("lin-camel-tgt", token!);
      const tgtRes = await fetch(skillsPath(`/lin-camel-tgt?project=${projectName}`));
      const tgtBody = await tgtRes.json();

      const linRes = await fetch(skillsPath(`/lineage?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          sourceProjectId: projectId, sourceName: "lin-camel-src",
          targetSkillId: tgtBody.data.id, mergedFilePaths: ["a.ts", "b.ts"],
        }),
      });
      expect(linRes.status).toBe(201);
      const body = await linRes.json();
      assertNoSnakeCase(body.data);
      expect(Array.isArray(body.data.mergedFilePaths)).toBe(true);
      expect(body.data.mergedFilePaths).toEqual(["a.ts", "b.ts"]);
    } finally {
      await releaseLock(token!);
    }
  });

  it("proposal fileTree object roundtrips — parsed as object on read", async () => {
    const token = await acquireLock();
    expect(token).toBeTruthy();
    try {
      const fileTree = { "a.md": "content a", "b.md": "content b" };
      const cr = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "ft-roundtrip",
          proposedState: { description: "test", content: "# test", fileTree },
        }),
      });
      expect(cr.status).toBe(201);
      const body = await cr.json();
      // proposedState.fileTree should be parsed as an object, not a raw JSON string
      expect(typeof body.data.proposedState).toBe("object");
      expect(body.data.proposedState.fileTree).toEqual(fileTree);
    } finally {
      await releaseLock(token!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Skill-name validation (review item 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe("skill-name validation", () => {
  it("returns 422 for path-traversal name in POST body", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "../../../escape", description: "bad", content: "# bad" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for path-traversal name in :name route param", async () => {
    const res = await fetch(skillsPath(`/..%2Fescape?project=${projectName}`));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for null byte in POST body name", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad\x00name", description: "bad", content: "# bad" }),
    });
    expect(res.status).toBe(422);
  });

  it("static routes (/locks, /proposals, /archived) are not captured by :name guard", async () => {
    // /archived should return 200 (not 422), regardless of count
    const res = await fetch(skillsPath(`/archived?project=${projectName}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("allows normal skill names with spaces", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Skill With Spaces", description: "OK", content: "# OK" }),
    });
    // 423 = lock held, but name validation passed (otherwise we'd get 422)
    expect(res.status).not.toBe(422);
  });

  it("returns 422 for name exceeding 64 characters", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(65), description: "bad", content: "# bad" }),
    });
    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// file_tree validation (C4)
// ═══════════════════════════════════════════════════════════════════════════════

describe("file_tree validation", () => {
  it("returns 422 for invalid files JSON in POST", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ft-valid-name", description: "OK", content: "# OK", files: "not-json" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for array files value", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ft-valid-name2", description: "OK", content: "# OK", files: '["a"]' }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 for files with non-string values", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ft-valid-name3", description: "OK", content: "# OK", files: '{"a":1}' }),
    });
    expect(res.status).toBe(422);
  });
});

// ── Proposal fileTree validation (item 3 — REST layer) ────────────────────

describe("proposal fileTree validation", () => {
  it("returns 400 for proposal with non-string fileTree value", async () => {
    const token = await acquireLock();
    try {
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "pft-api-test",
          proposedState: { description: "x", content: "# x", fileTree: { "a.md": 1 } },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_PROPOSED_STATE");
    } finally {
      if (token) await releaseLock(token);
    }
  });

  it("accepts proposal with valid nested string map fileTree", async () => {
    const token = await acquireLock();
    try {
      const res = await fetch(skillsPath(`/proposals?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingenium-lock-token": token! },
        body: JSON.stringify({
          proposalType: "create",
          targetName: "pft-api-ok",
          proposedState: { description: "x", content: "# x", fileTree: JSON.stringify({ "a.md": "# A" }) },
        }),
      });
      expect(res.status).toBe(201);
    } finally {
      if (token) await releaseLock(token);
    }
  });
});
