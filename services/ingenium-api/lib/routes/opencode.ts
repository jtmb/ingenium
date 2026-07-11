import { Router } from "express";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { logger } from "ingenium-core";

export const opencodeRouter = Router();

// GET /api/v1/opencode/messages — read recent user messages from the OpenCode DB
opencodeRouter.get("/messages", (req, res) => {
  const since = parseInt(req.query.since as string || "0", 10);
  const limit = Math.min(parseInt(req.query.limit as string || "500", 10), 2000);

  try {
    // Host OpenCode DB mounted at /var/opencode/ via docker-compose
    const dbPath = process.env.INGENIUM_OPENCODE_DB_PATH || "/var/opencode/opencode.db";

    if (!existsSync(dbPath)) {
      logger.warn("opencode", "OpenCode DB not found", { path: dbPath });
      res.json({ data: { messages: [], total: 0 } });
      return;
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const rows = db.prepare(`
      SELECT
        json_extract(p.data, '$.text') as text,
        p.time_created
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
        AND length(json_extract(p.data, '$.text')) > 10
        AND p.time_created > ?
      ORDER BY p.time_created DESC
      LIMIT ?
    `).all(since, limit);

    db.close();

    const messages = rows.map((r: any) => ({
      text: String(r.text || ""),
      time_created: r.time_created,
    }));

    logger.info("opencode", `Returned ${messages.length} user messages from OpenCode DB (since=${since}, limit=${limit})`);

    res.json({ data: { messages, total: messages.length } });
  } catch (err: any) {
    logger.error("opencode", "Failed to read OpenCode DB", { error: err.message });
    res.json({ data: { messages: [], total: 0, error: err.message } });
  }
});
