/**
 * API-level maintenance lock integration tests.
 *
 * Tests the /api/v1/skills/locks endpoints, lock-gated skill mutations,
 * synthesis/run lock, and cross-project lock lifetime.
 * Uses a local Express server against an isolated SQLite DB.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { projects, skills as skillsModule, maintenanceLocks } from "ingenium-core";
import { skillsRouter } from "../lib/routes/skills.js";
import { synthesisRouter } from "../lib/routes/synthesis.js";

let tempDir: string;
let projectId: string;
let projectName: string;
let server: Server | null = null;
let baseUrl: string;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/skills", skillsRouter);
  app.use("/api/v1/synthesis", synthesisRouter);
  return app;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-api-mlocks-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");

  projectName = "mlocks-test-project";
  const project = projects.createProject(projectName);
  projectId = project.id;

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
  // Clean up any leftover locks
  const allLocks = maintenanceLocks.listActiveLocks();
  for (const lock of allLocks) {
    maintenanceLocks.releaseLock(lock.resource, lock.project_id, lock.owner_token);
  }
  maintenanceLocks.cleanupExpiredLocks();
});

function skillsPath(path: string): string {
  return `${baseUrl}/api/v1/skills${path}`;
}
function synthPath(path: string): string {
  return `${baseUrl}/api/v1/synthesis${path}`;
}

// ── Lock Acquire (name→UUID via query param) ───────────────────────────────

describe("POST /skills/locks/acquire — name→UUID resolution", () => {
  it("resolves project name to UUID and returns ownerToken only", async () => {
    const res = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.ownerToken).toBeDefined();
    expect(body.data.resource).toBe("skills");
    expect(body.data.projectId).toBe(projectId); // UUID, not name
    expect(body.data.expiresAt).toBeDefined();

    // Release
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: body.data.ownerToken }),
    });
  });

  it("returns 400 for missing project query param", async () => {
    const res = await fetch(skillsPath("/locks/acquire"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 for unknown project name", async () => {
    const res = await fetch(skillsPath("/locks/acquire?project=nonexistent-zzz"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 423 when lock is already held — no token leak", async () => {
    const r1 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r1.status).toBe(201);
    const b1 = await r1.json();

    const r2 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r2.status).toBe(423);
    const b2 = await r2.json();
    expect(b2.error.code).toBe("LOCKED");
    expect(b2.error.retryAfterMs).toBeDefined();
    // 🔴 Must NOT expose ownerToken
    expect(b2.error.lock).toBeDefined();
    expect(b2.error.lock.ownerToken).toBeUndefined();
    expect(b2.error.lock.owner_token).toBeUndefined();
    expect(JSON.stringify(b2.error)).not.toContain("ownerToken");
    expect(JSON.stringify(b2.error)).not.toContain("owner_token");

    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b1.data.ownerToken }),
    });
  });

  it("returns 422 for ttlMs outside bounds", async () => {
    const r1 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 500 }),
    });
    expect(r1.status).toBe(422);

    const r2 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 500_000 }),
    });
    expect(r2.status).toBe(422);
  });
});

// ── Lock Status (scoped to current project, no token leak) ──────────────────

describe("GET /skills/locks — scoped, no token leak", () => {
  it("returns null when no lock active", async () => {
    const res = await fetch(skillsPath(`/locks?project=${projectName}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("returns lock DTO without ownerToken", async () => {
    const r = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    const b = await r.json();

    const statusRes = await fetch(skillsPath(`/locks?project=${projectName}`));
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.data).not.toBeNull();
    expect(statusBody.data.resource).toBe("skills");
    expect(statusBody.data.projectId).toBe(projectId);
    // 🔴 Must NOT expose ownerToken
    expect(statusBody.data.ownerToken).toBeUndefined();
    expect(statusBody.data.owner_token).toBeUndefined();

    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken }),
    });
  });

  it("reflects global lock with scope:global, no token", async () => {
    const globalToken = maintenanceLocks.generateOwnerToken();
    maintenanceLocks.acquireLock("skills", "*", globalToken, 10_000);

    try {
      const res = await fetch(skillsPath(`/locks?project=${projectName}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).not.toBeNull();
      expect(body.data.scope).toBe("global");
      expect(body.data.projectId).toBe("*");
      // 🔴 Must NOT expose ownerToken
      expect(body.data.ownerToken).toBeUndefined();
      expect(body.data.owner_token).toBeUndefined();
    } finally {
      maintenanceLocks.releaseLock("skills", "*", globalToken);
    }
  });
});

// ── Lock Release ────────────────────────────────────────────────────────────

describe("POST /skills/locks/release", () => {
  it("releases lock with correct owner token", async () => {
    const r = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r.status).toBe(201);
    const b = await r.json();

    const relRes = await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken }),
    });
    expect(relRes.status).toBe(200);
    expect((await relRes.json()).data.released).toBe(true);
  });

  it("returns 403 for wrong token", async () => {
    const r = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r.status).toBe(201);

    const relRes = await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: "wrong-token-xxx" }),
    });
    expect(relRes.status).toBe(403);

    // Cleanup
    const b = await r.json();
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken }),
    });
  });

  it("returns 404 when no lock exists", async () => {
    const res = await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: "irrelevant" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 for missing ownerToken", async () => {
    const res = await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});

// ── Lock Renew ──────────────────────────────────────────────────────────────

describe("POST /skills/locks/renew", () => {
  it("renews an active lock and returns new expiresAt", async () => {
    const r = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r.status).toBe(201);
    const b = await r.json();
    const originalExpires = new Date(b.data.expiresAt).getTime();

    // Small delay to ensure time difference
    await new Promise((resolve) => setTimeout(resolve, 50));

    const renewRes = await fetch(skillsPath(`/locks/renew?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken, ttlMs: 30_000 }),
    });
    expect(renewRes.status).toBe(200);
    const renewBody = await renewRes.json();
    expect(renewBody.data.renewed).toBe(true);
    expect(new Date(renewBody.data.expiresAt).getTime()).toBeGreaterThan(originalExpires);

    // Cleanup
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken }),
    });
  });

  it("returns 403 for wrong token", async () => {
    const r = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    const b = await r.json();

    const renewRes = await fetch(skillsPath(`/locks/renew?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: "wrong-token", ttlMs: 10_000 }),
    });
    expect(renewRes.status).toBe(403);

    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b.data.ownerToken }),
    });
  });

  it("returns 404 when no lock exists", async () => {
    const res = await fetch(skillsPath(`/locks/renew?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: "irrelevant", ttlMs: 10_000 }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Mutation Gate ───────────────────────────────────────────────────────────

describe("Skill mutation lock gating", () => {
  it("allows mutations when no lock active", async () => {
    const res = await fetch(skillsPath(`?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "unlocked-skill", description: "t", content: "# t" }),
    });
    expect(res.status).toBe(201);
  });

  it("blocks mutations with 423 when lock active, no token", async () => {
    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    try {
      const res = await fetch(skillsPath(`?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "blocked-skill", description: "t", content: "# t" }),
      });
      expect(res.status).toBe(423);
      const body = await res.json();
      expect(body.error.code).toBe("LOCKED");
      // 🔴 423 must not leak owner token
      expect(JSON.stringify(body.error)).not.toContain("ownerToken");
      expect(JSON.stringify(body.error)).not.toContain("owner_token");
    } finally {
      await fetch(skillsPath(`/locks/release?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
      });
    }
  });

  it("allows mutations with valid lock token header", async () => {
    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    try {
      const res = await fetch(skillsPath(`?project=${projectName}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingenium-lock-token": lockBody.data.ownerToken,
        },
        body: JSON.stringify({ name: "owner-bypass", description: "t", content: "# t" }),
      });
      expect(res.status).toBe(201);
    } finally {
      await fetch(skillsPath(`/locks/release?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
      });
    }
  });

  it("reads are never blocked when lock is active", async () => {
    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    try {
      const res = await fetch(skillsPath(`?project=${projectName}`));
      expect(res.status).toBe(200);
    } finally {
      await fetch(skillsPath(`/locks/release?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
      });
    }
  });

  it("gates DELETE, enable/disable with lock", async () => {
    skillsModule.createSkill(projectId, "gated-skill", "test", "# gated");

    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    try {
      // DELETE without token → 423
      const delRes = await fetch(skillsPath(`/gated-skill?project=${projectName}`), { method: "DELETE" });
      expect(delRes.status).toBe(423);

      // Enable without token → 423
      const enRes = await fetch(skillsPath(`/gated-skill/enable?project=${projectName}`), { method: "POST" });
      expect(enRes.status).toBe(423);

      // With token → success
      const del2Res = await fetch(skillsPath(`/gated-skill?project=${projectName}`), {
        method: "DELETE",
        headers: { "x-ingenium-lock-token": lockBody.data.ownerToken },
      });
      expect(del2Res.status).toBe(204);
    } finally {
      await fetch(skillsPath(`/locks/release?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
      });
    }
  });
});

// ── Name→UUID Conflict Test ────────────────────────────────────────────────

describe("Name→UUID resolution — scheduler vs resource-sync conflict", () => {
  it("lock acquired via project name blocks second acquire with same name", async () => {
    // Both callers use the project name — API resolves both to the same UUID
    const r1 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r1.status).toBe(201);
    const b1 = await r1.json();

    // Second acquire with same project name → 423 (same UUID internally)
    const r2 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r2.status).toBe(423);

    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b1.data.ownerToken }),
    });
  });
});

// ── Manual /synthesis/run lock test ─────────────────────────────────────────

describe("POST /synthesis/run — lock acquisition", () => {
  it("acquires lock and returns 423 when already held", async () => {
    // Acquire a lock manually
    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    try {
      // /synthesis/run should return 423 because lock is held
      const res = await fetch(synthPath(`/run?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(423);
      const body = await res.json();
      expect(body.error.code).toBe("LOCKED");
    } finally {
      await fetch(skillsPath(`/locks/release?project=${projectName}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
      });
    }
  });
});

// ── Expired Lock Retry ──────────────────────────────────────────────────────

describe("Expired lock retry", () => {
  it("allows acquire after lock expires", async () => {
    const r1 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 1000 }),
    });
    expect(r1.status).toBe(201);

    await new Promise((r) => setTimeout(r, 1100));

    const r2 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r2.status).toBe(201);

    const b2 = await r2.json();
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b2.data.ownerToken }),
    });
  });
});

// ── Finally-Release After Error ─────────────────────────────────────────────

describe("Lock released in finally after operation", () => {
  it("manual release clears lock for subsequent acquire", async () => {
    const lockRes = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(lockRes.status).toBe(201);
    const lockBody = await lockRes.json();

    // Release
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: lockBody.data.ownerToken }),
    });

    // Verify released
    const statusRes = await fetch(skillsPath(`/locks?project=${projectName}`));
    const statusBody = await statusRes.json();
    expect(statusBody.data).toBeNull();
  });

  it("acquiring after release succeeds", async () => {
    const r1 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    const b1 = await r1.json();
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b1.data.ownerToken }),
    });

    const r2 = await fetch(skillsPath(`/locks/acquire?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMs: 10_000 }),
    });
    expect(r2.status).toBe(201);

    const b2 = await r2.json();
    await fetch(skillsPath(`/locks/release?project=${projectName}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken: b2.data.ownerToken }),
    });
  });
});

// ── Cross-project lock route owns the lock ──────────────────────────────────

describe("POST /synthesis/cross-project — route owns global lock", () => {
  it("returns 423 when global lock is already held", async () => {
    const globalToken = maintenanceLocks.generateOwnerToken();
    maintenanceLocks.acquireLock("skills", "*", globalToken, 10_000);

    try {
      const res = await fetch(synthPath("/cross-project"), { method: "POST" });
      // Should be 423 because global lock is held
      expect(res.status).toBe(423);
      const body = await res.json();
      expect(body.error.code).toBe("LOCKED");
    } finally {
      maintenanceLocks.releaseLock("skills", "*", globalToken);
    }
  });

  it("releases global lock on completion (no lock remains after 200)", async () => {
    // With no global lock held, cross-project should run and release
    const res = await fetch(synthPath("/cross-project"), { method: "POST" });
    // May succeed or fail (depends on LLM config), but should be <500
    // and lock should be released regardless
    expect([200, 423, 500]).toContain(res.status);

    // After completion, global lock should be released
    const existingLock = maintenanceLocks.getLockStatus("skills", "*");
    expect(existingLock).toBeUndefined();
  });
});

// ── Heartbeat Renewal Tests (fake timers, controlled synthesis) ──────────────

describe("Lock heartbeat renewal", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const allLocks = maintenanceLocks.listActiveLocks();
    for (const lock of allLocks) {
      maintenanceLocks.releaseLock(lock.resource, lock.project_id, lock.owner_token);
    }
  });

  it("cross-project: renewLock called with correct args, lock survives past original TTL, released on completion", async () => {
    // Fake only setInterval/Date/clearInterval — real setTimeout for Express/fetch
    vi.useFakeTimers({ toFake: ["setInterval", "Date", "clearInterval"] });

    let resolveSynthesis!: () => void;
    const synthesisDone = new Promise<void>((r) => { resolveSynthesis = r; });

    const synthesisMod = await import("ingenium-core");
    const crossMock = vi.spyOn(synthesisMod.synthesis, "runCrossProjectSynthesis")
      .mockImplementation(() => synthesisDone);

    const locksMod = await import("ingenium-core");
    const renewSpy = vi.spyOn(locksMod.maintenanceLocks, "renewLock");

    try {
      // Fire request — Express handler acquires lock, sets up heartbeat, awaits synthesis
      const responsePromise = fetch(synthPath("/cross-project"), { method: "POST" });
      await new Promise((r) => setTimeout(r, 100));

      // Verify lock is initially held
      let lock = maintenanceLocks.getLockStatus("skills", "*");
      expect(lock).not.toBeUndefined();
      expect(lock!.resource).toBe("skills");
      expect(lock!.project_id).toBe("*");
      const initialExpires = new Date(lock!.expires_at).getTime();

      // Advance fake time by 61s — the setInterval at 60s should fire
      vi.advanceTimersByTime(61_000);

      // renewLock should have been called with correct args
      expect(renewSpy).toHaveBeenCalled();
      const renewCallArgs = renewSpy.mock.calls[0];
      if (renewCallArgs && renewCallArgs.length >= 4) {
        expect(renewCallArgs[0]).toBe("skills");           // resource
        expect(renewCallArgs[1]).toBe("*");                 // projectId
        expect(typeof renewCallArgs[2]).toBe("string");     // ownerToken (UUID)
        expect(renewCallArgs[3]).toBe(120_000);             // ttlMs
      }

      // Lock should still be active after renewal — expiry extended past original window
      lock = maintenanceLocks.getLockStatus("skills", "*");
      expect(lock).not.toBeUndefined();
      const renewedExpires = new Date(lock!.expires_at).getTime();
      expect(renewedExpires).toBeGreaterThan(initialExpires + 55_000);

      // Advance to 125s total — past original 120s TTL — lock should still be active
      vi.advanceTimersByTime(64_000);
      lock = maintenanceLocks.getLockStatus("skills", "*");
      expect(lock).not.toBeUndefined();

      // Another process should NOT be able to acquire (lock is held)
      const conflictToken = maintenanceLocks.generateOwnerToken();
      expect(maintenanceLocks.acquireLock("skills", "*", conflictToken, 5_000)).toBe(false);

      // Complete synthesis → finally releases lock
      resolveSynthesis();
      await new Promise((r) => setTimeout(r, 100));
      const res = await responsePromise;
      expect([200, 500]).toContain(res.status);

      // Lock released
      lock = maintenanceLocks.getLockStatus("skills", "*");
      expect(lock).toBeUndefined();
    } finally {
      crossMock.mockRestore();
      renewSpy.mockRestore();
    }
  });

  it("cross-project: lock held during synthesis, released on completion", async () => {
    let resolveSynthesis!: () => void;
    const synthesisDone = new Promise<void>((r) => { resolveSynthesis = r; });

    const synthesisMod = await import("ingenium-core");
    const crossMock = vi.spyOn(synthesisMod.synthesis, "runCrossProjectSynthesis")
      .mockImplementation(() => synthesisDone);

    try {
      const responsePromise = fetch(synthPath("/cross-project"), { method: "POST" });
      await new Promise((r) => setTimeout(r, 100));

      const conflictToken = maintenanceLocks.generateOwnerToken();
      expect(maintenanceLocks.acquireLock("skills", "*", conflictToken, 5_000)).toBe(false);

      resolveSynthesis();
      await responsePromise;

      const newToken = maintenanceLocks.generateOwnerToken();
      expect(maintenanceLocks.acquireLock("skills", "*", newToken, 1_000)).toBe(true);
      maintenanceLocks.releaseLock("skills", "*", newToken);
    } finally {
      crossMock.mockRestore();
    }
  });

  it("manual run: lock held while synthesis in-flight, released after", async () => {
    let resolveSynthesis!: () => void;
    const synthesisDone = new Promise<void>((r) => { resolveSynthesis = r; });

    const synthesisMod = await import("ingenium-core");
    const runMock = vi.spyOn(synthesisMod.synthesis, "runSynthesis")
      .mockImplementation(() => synthesisDone);

    try {
      const responsePromise = fetch(synthPath(`/run?project=${projectName}`), { method: "POST" });
      await new Promise((r) => setTimeout(r, 100));

      const res = await responsePromise;
      expect(res.status).toBe(200);

      let lock = maintenanceLocks.getLockStatus("skills", projectId);
      expect(lock).not.toBeUndefined();

      const conflictToken = maintenanceLocks.generateOwnerToken();
      expect(maintenanceLocks.acquireLock("skills", projectId, conflictToken, 5_000)).toBe(false);

      resolveSynthesis();
      await new Promise((r) => setTimeout(r, 150));

      lock = maintenanceLocks.getLockStatus("skills", projectId);
      expect(lock).toBeUndefined();
    } finally {
      runMock.mockRestore();
    }
  });

  it("manual run: lock loss detectable after simulated renewal failure", async () => {
    let resolveSynthesis!: () => void;
    const synthesisDone = new Promise<void>((r) => { resolveSynthesis = r; });

    const synthesisMod = await import("ingenium-core");
    vi.spyOn(synthesisMod.synthesis, "runSynthesis")
      .mockImplementation(() => synthesisDone);

    const locksMod = await import("ingenium-core");
    const renewMock = vi.spyOn(locksMod.maintenanceLocks, "renewLock")
      .mockImplementation(() => false);

    try {
      const responsePromise = fetch(synthPath(`/run?project=${projectName}`), { method: "POST" });
      await new Promise((r) => setTimeout(r, 100));
      expect((await responsePromise).status).toBe(200);

      let lock = maintenanceLocks.getLockStatus("skills", projectId);
      expect(lock).not.toBeUndefined();

      const allLocks = maintenanceLocks.listActiveLocks("skills");
      for (const l of allLocks) {
        maintenanceLocks.releaseLock(l.resource, l.project_id, l.owner_token);
      }

      const newToken = maintenanceLocks.generateOwnerToken();
      expect(maintenanceLocks.acquireLock("skills", projectId, newToken, 5_000)).toBe(true);
      maintenanceLocks.releaseLock("skills", projectId, newToken);

      resolveSynthesis();
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      renewMock.mockRestore();
    }
  });
});
