import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { authorization, bootstrap, contextConversations, getAuthenticationFoundationMigrationStatus, getDb, identity, observations, organizations, personality, projects, rag, resetDbForTest } from "../lib/index.js";

let directory = "";

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-content-tenancy-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data");
  getDb(process.env.INGENIUM_CORE_DB_PATH);
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("AUTH-105 content tenancy", () => {
  it("applies migration 098 completely and idempotently", () => {
    expect(getAuthenticationFoundationMigrationStatus()["098"]).toEqual(expect.objectContaining({ complete: true, missing: [] }));
    resetDbForTest();
    getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(getDb().prepare("SELECT migration, phase FROM content_tenancy_manifests").get()).toEqual({ migration: 98, phase: "verified" });
  });

  it("preserves private legacy content until the pending bootstrap owner is claimed", async () => {
    const legacyPath = join(directory, "legacy-content.db");
    const legacy = new Database(legacyPath);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    const files = readdirSync(migrations)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 97 && !file.includes("_upgrade"))
      .sort();
    expect(files).toHaveLength(97);
    for (const file of files) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    const projectId = "00000000-0000-4000-8000-000000000198";
    const now = new Date().toISOString();
    legacy.prepare(`INSERT INTO projects
      (id, name, path, is_global, created_at, updated_at, organization_id)
      VALUES (?, 'legacy-content', '/legacy-content', 1, ?, ?, ?)`)
      .run(projectId, now, now, organizations.BOOTSTRAP_ORGANIZATION_ID);
    const observationId = Number(legacy.prepare(`INSERT INTO observations
      (project_id, observation_type, content, source, created_at, updated_at)
      VALUES (?, 'preference', 'private legacy preference', 'manual', ?, ?)`)
      .run(projectId, now, now).lastInsertRowid);
    legacy.close();

    resetDbForTest();
    process.env.INGENIUM_CORE_DB_PATH = legacyPath;
    const upgraded = getDb(legacyPath);
    expect(upgraded.prepare("SELECT state, owner_user_id FROM bootstrap_state WHERE singleton = 1").get())
      .toEqual({ state: "pending", owner_user_id: null });
    expect(upgraded.prepare("SELECT owner_user_id, visibility FROM observations WHERE id = ?").get(observationId))
      .toEqual({ owner_user_id: bootstrap.PENDING_BOOTSTRAP_OWNER_ID, visibility: "private" });
    expect(upgraded.prepare("SELECT status FROM users WHERE id = ?").get(bootstrap.PENDING_BOOTSTRAP_OWNER_ID))
      .toEqual({ status: "disabled" });
    expect(upgraded.prepare("SELECT count(*) AS count FROM auth_identities WHERE user_id = ?").get(bootstrap.PENDING_BOOTSTRAP_OWNER_ID))
      .toEqual({ count: 0 });

    const claimed = await bootstrap.claimBootstrap({
      email: "owner@example.test",
      displayName: "Owner",
      password: "correct horse battery staple",
    });
    expect(claimed.userId).toBe(bootstrap.PENDING_BOOTSTRAP_OWNER_ID);
    expect(upgraded.prepare("SELECT state, owner_user_id FROM bootstrap_state WHERE singleton = 1").get())
      .toEqual({ state: "claimed", owner_user_id: bootstrap.PENDING_BOOTSTRAP_OWNER_ID });
    expect(upgraded.prepare("SELECT email_normalized, display_name, status FROM users WHERE id = ?").get(bootstrap.PENDING_BOOTSTRAP_OWNER_ID))
      .toEqual({ email_normalized: "owner@example.test", display_name: "Owner", status: "active" });
    expect(upgraded.prepare("SELECT count(*) AS count FROM password_credentials WHERE user_id = ?").get(bootstrap.PENDING_BOOTSTRAP_OWNER_ID))
      .toEqual({ count: 1 });
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rejects cross-organization Docs children and RAG checkpoint bindings", () => {
    const foreignOrganization = organizations.createOrganization("Foreign content", "foreign-content");
    const localProject = projects.createProject("content-local");
    const foreignProject = projects.createProject("content-foreign", false, foreignOrganization);
    const db = getDb();
    const localSpace = db.prepare("SELECT id FROM docs_spaces WHERE organization_id = ?").get(organizations.BOOTSTRAP_ORGANIZATION_ID) as { id: number };
    expect(() => db.prepare(
      "INSERT INTO docs_pages (organization_id, space_id, title, slug, content, status) VALUES (?, ?, 'foreign', 'foreign', '', 'draft')",
    ).run(foreignOrganization, localSpace.id)).toThrow(/scope must match/);

    const owner = identity.createUser("content-owner@example.test", "Content Owner");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "member");
    const conversation = contextConversations.createContextConversation(localProject.id, {
      title: "Private content",
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerUserId: owner.id,
      visibility: "private",
    });
    contextConversations.appendContextMessage(localProject.id, conversation.id, { role: "user", content: "secret", expectedRevision: 0 });
    const foreignSource = rag.ingestCanonicalSource(foreignProject.id, "foreign", "foreign content", { visibility: "project" });
    expect(() => contextConversations.createContextCheckpoint(localProject.id, conversation.id, {
      expectedRevision: 1,
      ragSourceIds: [foreignSource.id],
    })).toThrowError(expect.objectContaining({ code: "RAG_SOURCE_NOT_FOUND" }));
  });

  it("allows organization-local Docs names and slugs", () => {
    const foreignOrganization = organizations.createOrganization("Foreign docs", "foreign-docs");
    const db = getDb();
    for (const organizationId of [organizations.BOOTSTRAP_ORGANIZATION_ID, foreignOrganization]) {
      db.prepare(
        "INSERT INTO docs_spaces (organization_id, name, slug, description, icon) VALUES (?, 'Shared', 'shared', '', 'folder')",
      ).run(organizationId);
      db.prepare(
        "INSERT INTO docs_templates (organization_id, name, content) VALUES (?, 'Shared', '# Shared')",
      ).run(organizationId);
      db.prepare(
        "INSERT INTO docs_tags (organization_id, name, slug) VALUES (?, 'Shared', 'shared')",
      ).run(organizationId);
    }
    expect(db.prepare("SELECT count(*) AS count FROM docs_spaces WHERE slug = 'shared'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM docs_templates WHERE name = 'Shared'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT count(*) AS count FROM docs_tags WHERE slug = 'shared'").get()).toEqual({ count: 2 });
  });

  it("keeps restored conversations private to the source owner", () => {
    const owner = identity.createUser("restore-owner@example.test", "Restore Owner");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "member");
    const project = projects.createProject("content-restore");
    const conversation = contextConversations.createContextConversation(project.id, {
      title: "Private restore",
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerUserId: owner.id,
      visibility: "private",
    });
    contextConversations.appendContextMessage(project.id, conversation.id, { role: "user", content: "private body", expectedRevision: 0 });
    const checkpoint = contextConversations.createContextCheckpoint(project.id, conversation.id, { expectedRevision: 1 });
    const authorization = contextConversations.authorizeContextMaintenanceAction(project.id, conversation.id, {
      operation: "restore_checkpoint", checkpointId: checkpoint.checkpoint.id, expectedRevision: 1,
    });
    const restored = contextConversations.restoreContextCheckpoint(project.id, conversation.id, checkpoint.checkpoint.id, {
      expectedRevision: 1, confirmationToken: authorization.confirmationToken,
    });
    expect(restored.conversation).toMatchObject({ owner_user_id: owner.id, visibility: "private" });
    expect(contextConversations.getContextMessage(project.id, restored.conversation.id, restored.checkpoint.through_message_id)?.content).toBe("private body");
  });

  it("hides private conversations and learning content from organization administrators", () => {
    const owner = identity.createUser("private-owner@example.test", "Private Owner");
    const admin = identity.createUser("content-admin@example.test", "Content Admin");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, owner.id, "member");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, admin.id, "admin");
    const project = projects.createProject("private-content-access");
    const conversation = contextConversations.createContextConversation(project.id, {
      title: "Owner only",
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID,
      ownerUserId: owner.id,
      visibility: "private",
    });
    const ownerPrincipal: authorization.AuthorizationPrincipal = { type: "browser-user", id: owner.id, scopes: ["*"], organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID };
    const adminPrincipal: authorization.AuthorizationPrincipal = { type: "browser-user", id: admin.id, scopes: ["*"], organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID };
    const scope: authorization.ContentScope = {
      resourceType: "context_conversation", resourceId: conversation.id,
      organizationId: conversation.organization_id, projectId: conversation.project_id,
      visibility: conversation.visibility, ownerUserId: conversation.owner_user_id,
    };
    expect(authorization.requireContentPermission(ownerPrincipal, scope, "read")).toMatchObject({ allowed: true, visible: true });
    expect(authorization.requireContentPermission(adminPrincipal, scope, "read")).toMatchObject({ allowed: false, visible: false });

    const privateSource = rag.ingestCanonicalSource(project.id, "owner source", "owner-only RAG body", {
      ownerUserId: owner.id, visibility: "restricted",
    });
    expect(rag.searchChunks(project.id, "owner-only RAG", 10, false, owner.id)).toContainEqual(expect.objectContaining({ source_id: privateSource.id }));
    expect(rag.searchChunks(project.id, "owner-only RAG", 10, false, admin.id)).toEqual([]);
    expect(rag.searchChunks(project.id, "owner-only RAG", 10, false, null)).toEqual([]);

    const privateObservation = observations.storeObservation(project.id, "preference", "owner preference", 5, "manual", undefined, undefined, {
      organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID, ownerUserId: owner.id, visibility: "private",
    });
    const privateTrait = personality.upsertTrait(project.id, "communication_style", "owner trait", undefined, 0.5, privateObservation.id, undefined, {
      ownerUserId: owner.id, visibility: "private",
    });
    expect(observations.getObservation(project.id, privateObservation.id, owner.id)?.content).toBe("owner preference");
    expect(observations.getObservation(project.id, privateObservation.id, admin.id)).toBeUndefined();
    expect(personality.getTraits(project.id, undefined, undefined, owner.id)).toContainEqual(expect.objectContaining({ id: privateTrait.id }));
    expect(personality.getTraits(project.id, undefined, undefined, admin.id)).not.toContainEqual(expect.objectContaining({ id: privateTrait.id }));
  });
});
