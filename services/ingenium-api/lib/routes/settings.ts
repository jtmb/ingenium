import { Router } from "express";
import { settings, logger } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const settingsRouter = Router();

settingsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const key = req.query.key as string;
  if (!key) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key query parameter is required" } });
    return;
  }
  const value = settings.getSetting(projectId, key);
  res.json({ data: { key, value } });
});

settingsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { key, value } = req.body;
  if (!key || typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key and value are required" } });
    return;
  }
  settings.setSetting(projectId, key, value);
  res.json({ data: { key, value } });
});

// POST /api/v1/settings/test-llm — Proxies an LLM test connection server-side to avoid CORS
settingsRouter.post("/test-llm", (req, res) => {
  const { endpoint, model, apiKey } = req.body;
  if (!endpoint || !model) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "endpoint and model are required" } });
    return;
  }
  const baseUrl = endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with just 'ok'" }],
      max_tokens: 10,
    }),
    signal: AbortSignal.timeout(15000),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => "unknown");
        res.json({ data: { ok: false, status: r.status, message: text } });
        return;
      }
      res.json({ data: { ok: true } });
    })
    .catch((err: Error) => {
      logger.error("settings", `LLM test connection failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
      res.json({ data: { ok: false, status: 0, message: err.message } });
    });
});
