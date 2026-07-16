import { Router } from "express";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { logger } from "ingenium-core";

/**
 * Handles /api/v1/opencode — reads recent user messages directly from the OpenCode SQLite DB.
 * This is the ONLY route file that directly accesses a SQLite database outside the API authority
 * pattern, because the OpenCode DB is a separate process's database mounted via docker-compose volume.
 */
export const opencodeRouter = Router();

opencodeRouter.get("/messages", (req, res) => {
  const since = parseInt(req.query.since as string || "0", 10);
  const limit = Math.min(parseInt(req.query.limit as string || "500", 10), 2000);
  const project = (req.query.project as string) || "";

  try {
    // Host OpenCode DB mounted at /var/opencode/ via docker-compose
    const dbPath = process.env.INGENIUM_OPENCODE_DB_PATH || "/var/opencode/opencode.db";

    if (!existsSync(dbPath)) {
      logger.warn("opencode", "OpenCode DB not found", { path: dbPath });
      res.json({ data: { messages: [], total: 0 } });
      return;
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Build query with optional project (worktree directory) filter
    const projectClause = project
      ? "AND (s.directory LIKE ('%/' || ?) OR s.directory LIKE ('%\\' || ?))"
      : "";

    const sql = `
      SELECT
        json_extract(p.data, '$.text') as text,
        p.time_created
      FROM part p
      JOIN message m ON p.message_id = m.id
      JOIN session s ON m.session_id = s.id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
        AND length(json_extract(p.data, '$.text')) > 10
        AND p.time_created > ?
        AND s.parent_id IS NULL
        ${projectClause}
      ORDER BY p.time_created DESC
      LIMIT ?
    `;

    const params: any[] = [since];
    if (project) params.push(project, project);
    params.push(limit);

    const rows = db.prepare(sql).all(...params);

    db.close();

    const messages = rows.map((r: any) => ({
      text: String(r.text || ""),
      time_created: r.time_created,
    }));

    logger.info("opencode", `Returned ${messages.length} user messages from OpenCode DB (since=${since}, limit=${limit}, project=${project || "any"})`);

    res.json({ data: { messages, total: messages.length } });
  } catch (err: any) {
    logger.error("opencode", `Failed to read OpenCode DB: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.json({ data: { messages: [], total: 0, error: err.message } });
  }
});
