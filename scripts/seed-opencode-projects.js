#!/usr/bin/env node
const Database = require('/app/node_modules/better-sqlite3');
const dbPath = process.argv[2] || '/home/appuser/.local/share/opencode/opencode.db';
try {
  const db = new Database(dbPath);
  const existing = db.prepare('SELECT id, worktree FROM project WHERE id = ?').get('global');
  if (existing) {
    db.prepare('UPDATE project SET worktree = ?, name = ? WHERE id = ?').run('/workspace', 'repos', 'global');
    console.log('Updated workspace project: /workspace');
  } else {
    const ts = Date.now();
    db.prepare('INSERT INTO project (id, worktree, vcs, name, icon_color, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?,?,?)')
      .run('global', '/workspace', 'local', 'repos', 'blue', ts, ts, '[]');
    console.log('Created workspace project: /workspace');
  }
  db.close();
} catch (e) {
  console.log('OC DB init:', e.message);
}
