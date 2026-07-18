#!/usr/bin/env node

import { createHash } from "node:crypto";
import Database from "better-sqlite3";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const sourcePath = option("source");
const apiBase = option("api", "http://127.0.0.1:4097/api/v1").replace(/\/+$/, "");
const project = option("project", "global-default");
if (!sourcePath) throw new Error("Usage: migrate-thread-rag.mjs --source <thread.db> [--api URL] [--project NAME]");

const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
const sessions = db.prepare("SELECT id, name, description, created_at, updated_at FROM sessions ORDER BY id").all();
const entriesForSession = db.prepare("SELECT id, session_id, content, priority, tags, created_at, updated_at FROM entries WHERE session_id = ? ORDER BY id");
const uploadsForSession = db.prepare("SELECT id, session_id, filename, byte_offset, entries_created, created_at, updated_at FROM file_uploads WHERE session_id = ? ORDER BY id");

async function request(path, init) {
  const response = await fetch(`${apiBase}${path}`, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload;
}

const results = [];
try {
  for (const session of sessions) {
    const entries = entriesForSession.all(session.id);
    const uploads = uploadsForSession.all(session.id);
    const marker = `legacy-thread-session-${session.id}`;
    const records = [
      {
        kind: "legacy_thread_manifest",
        marker,
        session,
        entryCount: entries.length,
        uploads,
      },
      ...entries.map((entry) => ({ kind: "legacy_thread_entry", entry })),
    ];
    const text = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const expectedHash = createHash("sha256").update(text).digest("hex");
    const logicalPath = `import:legacy-thread/session/${session.id}`;
    const imported = await request(`/rag/sources/canonical?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Thread: ${session.name}`,
        text,
        sourcePath: logicalPath,
        mimeType: "application/x-ndjson",
        expectedHash,
        priority: 7,
        tags: ["legacy-thread", `thread-session-${session.id}`],
        metadata: {
          kind: "legacy_thread_session",
          provenance: "read-only-thread-db-migration",
          sessionId: session.id,
          sessionName: session.name,
          entryCount: entries.length,
          uploadCount: uploads.length,
          contentHash: expectedHash,
        },
      }),
    });
    if (imported.data.source_hash !== expectedHash) throw new Error(`Hash verification failed for Thread session ${session.id}`);
    const search = await request(`/rag/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(marker)}&limit=100`);
    if (!search.data.some((result) => result.source_id === imported.data.id)) {
      throw new Error(`Retrieval verification failed for Thread session ${session.id}`);
    }
    results.push({ sessionId: session.id, entries: entries.length, hash: expectedHash, sourceId: imported.data.id, chunks: imported.data.chunk_count });
  }
} finally {
  db.close();
}

console.log(JSON.stringify({ migrated: results.length, sessions: results }, null, 2));
