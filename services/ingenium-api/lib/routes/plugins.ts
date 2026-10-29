import { Router } from "express";
import { plugins, logger, getPluginsBase } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { resolve, relative, isAbsolute } from "node:path";
import { readSync, realpathSync, lstatSync, openSync, fstatSync, closeSync, constants, type Stats } from "node:fs";

/**
 * Handles /api/v1/plugins — plugin lifecycle management.
 * 🔴 Every lifecycle operation MUST sync .opencode/plugins/<file>.ts on disk
 * AND opencode.json's plugin array (docs/concepts/conventions.md).
 */
export const pluginsRouter = Router();

pluginsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const list = plugins.listPlugins(projectId);
  res.json({ data: list });
});

pluginsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const { name, file_path, source_content } = req.body;
    if (!name || !file_path) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name and file_path are required" } });
      return;
    }
    const plugin = plugins.createPlugin(projectId, name, file_path, source_content);
    res.status(201).json({ data: plugin });
  } catch (err: any) {
    logger.error("plugins", `Plugin creation failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
  }
});

// GET /:name/source — authoritative API source, then bounded legacy file read
pluginsRouter.get("/:name/source", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const plugin = plugins.getPlugin(projectId, req.params.name!);
  if (!plugin) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
    return;
  }
  // The API-owned source is authoritative, including an intentionally empty file.
  if (typeof plugin.source_content === "string") {
    res.json({ data: { source: plugin.source_content } });
    return;
  }
  let fd: number | undefined;
  try {
    const registeredBase = getPluginsBase(projectId);
    const base = realpathSync(registeredBase);
    const candidate = resolve(registeredBase, plugin.file_path);
    const relativeCandidate = relative(resolve(registeredBase), candidate);
    if (!relativeCandidate || isAbsolute(relativeCandidate) || relativeCandidate === ".." || relativeCandidate.startsWith("../") || relativeCandidate.startsWith("..\\")) throw new Error("Uncontained source");
    const canonical = realpathSync(candidate);
    const inside = relative(base, canonical);
    if (!inside || isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\")) throw new Error("Uncontained source");
    const before = lstatSync(canonical);
    if (!before.isFile() || before.nlink !== 1 || before.size > 4 * 1024 * 1024) throw new Error("Unavailable source");
    fd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const unchanged = (entry: Stats) => entry.isFile() && entry.nlink === 1
      && entry.dev === before.dev && entry.ino === before.ino && entry.size === before.size
      && entry.mtimeMs === before.mtimeMs && entry.ctimeMs === before.ctimeMs;
    if (!unchanged(fstatSync(fd))) throw new Error("Changed source");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("Truncated source");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0 || !unchanged(fstatSync(fd))
      || !unchanged(lstatSync(canonical)) || realpathSync(candidate) !== canonical) throw new Error("Changed source");
    res.json({ data: { source: bytes.toString("utf8") } });
  } catch {
    res.status(503).json({ error: { code: "PLUGIN_SOURCE_UNAVAILABLE", message: "Plugin source is unavailable. Restore its registered source before editing." } });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
});

pluginsRouter.get("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const plugin = plugins.getPlugin(projectId, req.params.name!);
  if (!plugin) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
    return;
  }
  res.json({ data: plugin });
});

pluginsRouter.put("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const parsed = plugins.pluginUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide only description (up to 2000 characters, no NUL), or only executable fields." } });
      return;
    }
    const updated = "description" in parsed.data
      ? plugins.updatePluginDescription(projectId, req.params.name!, parsed.data.description)
      : plugins.updatePlugin(projectId, req.params.name!, parsed.data);
    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
      return;
    }
    res.json({ data: updated });
  } catch (err: any) {
    if (typeof req.body?.description === "string") {
      const invalid = err.name === "ZodError";
      res.status(invalid ? 400 : 500).json({ error: {
        code: invalid ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
        message: invalid ? "Invalid plugin description update" : "Plugin description update failed",
      } });
      return;
    }
    logger.error("plugins", `Plugin update failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
  }
});

pluginsRouter.delete("/:name", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const deleted = plugins.deletePlugin(projectId, req.params.name!);
  if (!deleted) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
    return;
  }
  res.status(204).send();
});

// POST /:name/enable — enable a plugin (writes .ts to disk)
pluginsRouter.post("/:name/enable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const updated = plugins.enablePlugin(projectId, req.params.name!);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
    return;
  }
  res.json({ data: updated });
});

// POST /:name/disable — disable a plugin (removes .ts from disk)
pluginsRouter.post("/:name/disable", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const updated = plugins.disablePlugin(projectId, req.params.name!);
  if (!updated) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Plugin not found" } });
    return;
  }
  res.json({ data: updated });
});
