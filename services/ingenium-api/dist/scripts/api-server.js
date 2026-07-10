import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "../config/index.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { skillsRouter } from "../lib/routes/skills.js";
import { learningsRouter } from "../lib/routes/learnings.js";
import { tasksRouter } from "../lib/routes/tasks.js";
import { contextRouter } from "../lib/routes/context.js";
import { pluginsRouter } from "../lib/routes/plugins.js";
import { serversRouter } from "../lib/routes/servers.js";
import { settingsRouter } from "../lib/routes/settings.js";
import { agentsRouter } from "../lib/routes/agents.js";
import { observationsRouter } from "../lib/routes/observations.js";
import { personalityRouter } from "../lib/routes/personality.js";
import { synthesisRouter } from "../lib/routes/synthesis.js";
import { pipelineRouter } from "../lib/routes/pipeline.js";
import { emailsRouter } from "../lib/routes/emails.js";
const app = express();
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "2mb" }));
app.use(authMiddleware);
// Health check
app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
});
// Routes
app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1/skills", skillsRouter);
app.use("/api/v1/learnings", learningsRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/context", contextRouter);
app.use("/api/v1/plugins", pluginsRouter);
app.use("/api/v1/servers", serversRouter);
app.use("/api/v1/settings", settingsRouter);
app.use("/api/v1/agents", agentsRouter);
app.use("/api/v1/observations", observationsRouter);
app.use("/api/v1/personality", personalityRouter);
app.use("/api/v1/synthesis", synthesisRouter);
app.use("/api/v1/pipeline", pipelineRouter);
app.use("/api/v1/emails", emailsRouter);
// Error handler
app.use(errorHandler);
app.listen(config.port, () => {
    console.log(`ingenium-api listening on port ${config.port}`);
});
// ── Scheduled Synthesis ─────────────────────────────────
// Auto-trigger the synthesis pipeline every 15 minutes for ALL active projects
const SYNTHESIS_INTERVAL_MS = parseInt(process.env.SYNTHESIS_INTERVAL_MS ?? "900000", 10);
if (SYNTHESIS_INTERVAL_MS > 0) {
    async function triggerSynthesisForAllProjects() {
        try {
            // Fetch all active (non-archived) projects
            const projectsRes = await fetch(`http://localhost:${config.port}/api/v1/projects`);
            if (!projectsRes.ok) {
                console.warn(`[scheduler] Failed to fetch projects: ${projectsRes.status}`);
                return;
            }
            const projects = (await projectsRes.json()).data || [];
            for (const p of projects) {
                try {
                    const res = await fetch(`http://localhost:${config.port}/api/v1/synthesis/run?project=${p.name}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                    });
                    if (res.ok) {
                        const result = await res.json();
                        console.log(`[scheduler] Synthesis for "${p.name}": ${JSON.stringify(result.data)}`);
                    }
                    else {
                        console.warn(`[scheduler] Synthesis for "${p.name}" failed: ${res.status}`);
                    }
                }
                catch (err) {
                    console.debug(`[scheduler] Synthesis for "${p.name}" error: ${err.message}`);
                }
                // Sync skills: disk→DB then DB→disk
                try {
                    const syncRes = await fetch(`http://localhost:${config.port}/api/v1/skills/sync-all?project=${p.name}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                    });
                    if (syncRes.ok) {
                        const syncData = (await syncRes.json()).data;
                        if (syncData.synced_to_db > 0 || syncData.written_to_disk > 0) {
                            console.log(`[scheduler] Skill sync for "${p.name}": ${syncData.synced_to_db} from disk, ${syncData.written_to_disk} to disk`);
                        }
                    }
                }
                catch (err) {
                    console.debug(`[scheduler] Skill sync for "${p.name}" error: ${err.message}`);
                }
            }
        }
        catch (err) {
            console.debug(`[scheduler] Error fetching projects: ${err.message}`);
        }
    }
    // First run 30 seconds after startup, then every N ms
    setTimeout(() => triggerSynthesisForAllProjects(), 30000);
    setInterval(triggerSynthesisForAllProjects, SYNTHESIS_INTERVAL_MS);
    console.log(`[scheduler] Auto-synthesis every ${SYNTHESIS_INTERVAL_MS / 1000}s for all projects (first run in 30s)`);
}
export default app;
