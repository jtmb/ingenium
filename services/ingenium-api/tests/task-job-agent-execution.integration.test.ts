import { describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { getDb, resetDbForTest, vault } from "ingenium-core";
import { configureJobRunnerRuntimeForTesting, runningProcesses } from "../lib/job-runner.js";
import { jobsRouter } from "../lib/routes/jobs.js";
import { projectsRouter } from "../lib/routes/projects.js";
import { tasksRouter } from "../lib/routes/tasks.js";

const projectName = "task-job-agent-execution-fixture";
const prompt = "fixture prompt for selected agent execution";
const taskBodyCanary = "fixture-task-body-secret-canary";
const tokenCanary = "fixture-api-token-canary";
const marker = "fixture-agent-execution-marker";

type JobRun = {
  id: string;
  job_id: string;
  project_id: string;
  trigger: string;
  status: string;
  exit_code: number | null;
};

function restoreEnvironment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function projectUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectName)}`;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTerminalRun(baseUrl: string, jobId: string, runId: string): Promise<JobRun> {
  const deadline = Date.now() + 5_000;
  let lastStatus = "missing";
  while (Date.now() < deadline) {
    const response = await fetch(projectUrl(baseUrl, `/api/v1/jobs/${jobId}/runs`));
    expect(response.status).toBe(200);
    const body = await response.json() as { data: JobRun[] };
    const run = body.data.find((candidate) => candidate.id === runId);
    lastStatus = run?.status ?? "missing";
    if (run && ["success", "failed", "timeout", "cancelled"].includes(run.status)) return run;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for fixture job run ${runId} to finish (${lastStatus})`);
}

async function waitForRunProcessCleanup(runId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (runningProcesses.has(runId) && Date.now() < deadline) await sleep(20);
  expect(runningProcesses.has(runId)).toBe(false);
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(server.listening).toBe(false);
}

describe("caller-orchestrated task job execution", () => {
  it("does not enqueue a referenced job until the caller manually selects it, then runs without leakage", async () => {
    const originalEnvironment = {
      INGENIUM_API_TOKEN: process.env.INGENIUM_API_TOKEN,
      INGENIUM_CORE_DB_PATH: process.env.INGENIUM_CORE_DB_PATH,
      INGENIUM_HOME: process.env.INGENIUM_HOME,
      PATH: process.env.PATH,
    };
    const directory = mkdtempSync(join(tmpdir(), "ingenium-task-job-agent-execution-"));
    const fakeBin = join(directory, "bin");
    const fakeOpenCode = join(fakeBin, "opencode");
    let server: Server | undefined;
    let baseUrl = "";
    let projectCreated = false;
    let taskId = "";
    let jobId = "";
    let referenceId = "";
    let runId = "";
    let restoreRuntime: (() => void) | undefined;
    const fixturePath = `${fakeBin}${delimiter}${originalEnvironment.PATH ?? ""}`;
    const vaultRoot = join(directory, "job-secrets");

    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    process.env.INGENIUM_API_TOKEN = tokenCanary;
    process.env.PATH = fixturePath;

    try {
      mkdirSync(fakeBin, { recursive: true });
      writeFileSync(fakeOpenCode, `#!/bin/sh
set -eu
if [ "$#" -ne 8 ] || [ "$1" != "run" ] || [ "$2" != "${prompt}" ] || [ "$3" != "--agent" ] || [ "$4" != "fixture-agent" ] || [ "$5" != "--auto" ] || [ "$6" != "--pure" ] || [ "$7" != "--dir" ] || [ "$8" != "/workspace" ]; then
  printf '%s\\n' 'fixture-argv-mismatch' >&2
  exit 64
fi
if [ -n "\${INGENIUM_API_TOKEN-}" ]; then
  printf '%s\\n' 'fixture-token-leak' >&2
  exit 65
fi
case "$*" in
  *${taskBodyCanary}*)
    printf '%s\\n' 'fixture-task-body-leak' >&2
    exit 66
    ;;
esac
sleep 1
printf '%s\\n' '${marker}'
`);
      chmodSync(fakeOpenCode, 0o700);
      expect(fixturePath.split(delimiter)[0]).toBe(fakeBin);
      resetDbForTest();
      mkdirSync(vaultRoot, { mode: 0o700 });
      chmodSync(vaultRoot, 0o700);
      restoreRuntime = configureJobRunnerRuntimeForTesting({ workingDirectory: directory, vaultSecretRoot: vaultRoot });

      const app = express();
      app.use(express.json());
      app.use("/api/v1/projects", projectsRouter);
      app.use("/api/v1/tasks", tasksRouter);
      app.use("/api/v1/jobs", jobsRouter);
      server = createServer(app);
      await new Promise<void>((resolve) => {
        server!.listen(0, "127.0.0.1", () => {
          baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
          resolve();
        });
      });

      const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, json({ name: projectName }));
      expect(projectResponse.status).toBe(201);
      const project = (await projectResponse.json()).data as { id: string; organization_id: string };
      projectCreated = true;

      const taskResponse = await fetch(projectUrl(baseUrl, "/api/v1/tasks"), json({
        title: "Execute the referenced fixture job",
        description: taskBodyCanary,
      }));
      expect(taskResponse.status).toBe(201);
      taskId = (await taskResponse.json()).data.id as string;

      const jobResponse = await fetch(projectUrl(baseUrl, "/api/v1/jobs"), json({
        name: "Fixture job",
        agent: "fixture-agent",
        prompt_template: prompt,
      }));
      expect(jobResponse.status).toBe(201);
      const job = await jobResponse.json();
      jobId = job.data.id as string;
      expect(job.data).toMatchObject({
        agent: "fixture-agent",
        prompt_template: prompt,
        schedule_cron: null,
        trigger_event: null,
        vault_references: [],
      });
      vault.initVault(project.id, "fixture provider vault passphrase");
      expect(vault.unsealVault(project.id, "fixture provider vault passphrase").ok).toBe(true);
      const credentialItemId = vault.createItem(project.id, "Fixture provider credential", "api_key", "fixture-provider-key");
      const now = new Date().toISOString();
      const connectionId = "fixture-provider-connection";
      getDb().prepare(
        `INSERT INTO provider_connections
         (id, provider_key, owner_kind, organization_id, credential_item_id, display_name,
          provider_type, config_json, created_by_actor_type, created_at, updated_at)
         VALUES (?, 'fixture-provider', 'organization', ?, ?, 'Fixture Provider', 'managed', ?, 'system', ?, ?)`,
      ).run(connectionId, project.organization_id, credentialItemId,
        JSON.stringify({ name: "Fixture Provider", npm: "@ai-sdk/openai-compatible", models: ["fixture-model"] }), now, now);
      getDb().prepare(
        `INSERT INTO resource_grants
         (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id,
          permissions_json, granted_by_actor_type, created_at, updated_at)
         VALUES (?, ?, 'provider_connection', ?, 'service', ?, '["execute"]', 'system', ?, ?)`,
      ).run("10000000-0000-4000-8000-000000000106", project.organization_id, connectionId,
        job.data.service_principal_id, now, now);

      const referenceResponse = await fetch(projectUrl(baseUrl, `/api/v1/tasks/${taskId}/references`), json({
        source_type: "job",
        source_id: jobId,
      }));
      expect(referenceResponse.status).toBe(201);
      const referenceText = await referenceResponse.text();
      const reference = JSON.parse(referenceText).data as Record<string, unknown>;
      referenceId = reference.id as string;
      expect(reference).toMatchObject({
        source_type: "job",
        source_id: jobId,
        display_title: "Fixture job",
        display_detail: "Job",
        availability: "available",
      });
      expect(Object.keys(reference).sort()).toEqual([
        "availability",
        "created_at",
        "display_detail",
        "display_title",
        "id",
        "source_id",
        "source_timestamp",
        "source_type",
      ]);
      expect(referenceText).not.toContain(prompt);
      expect(referenceText).not.toContain(taskBodyCanary);
      expect(referenceText).not.toContain(tokenCanary);

      const beforeManualRun = await fetch(projectUrl(baseUrl, `/api/v1/jobs/${jobId}/runs`));
      expect(beforeManualRun.status).toBe(200);
      expect(await beforeManualRun.json()).toEqual({ data: [], total: 0 });

      const triggerResponse = await fetch(projectUrl(baseUrl, `/api/v1/jobs/${jobId}/run`), { method: "POST" });
      expect(triggerResponse.status).toBe(202);
      const triggerText = await triggerResponse.text();
      const triggeredRun = JSON.parse(triggerText).data as JobRun;
      runId = triggeredRun.id;
      expect(triggeredRun).toMatchObject({ job_id: jobId, trigger: "manual", status: "running" });

      const terminalRun = await waitForTerminalRun(baseUrl, jobId, runId);
      expect(terminalRun).toMatchObject({
        id: runId,
        job_id: jobId,
        trigger: "manual",
        status: "success",
        exit_code: 0,
      });
      await waitForRunProcessCleanup(runId);

      const logsResponse = await fetch(projectUrl(baseUrl, `/api/v1/jobs/runs/${runId}/logs`));
      expect(logsResponse.status).toBe(200);
      const logsText = await logsResponse.text();
      const logs = JSON.parse(logsText).data as Array<{ stream: string; line: string }>;
      expect(logs).toEqual([expect.objectContaining({ stream: "stderr", line: "Vault job output redacted." })]);

      for (const text of [triggerText, logsText]) {
        expect(text).not.toContain(taskBodyCanary);
        expect(text).not.toContain(tokenCanary);
      }
    } finally {
      let cleanupError: unknown;
      const cleanup = async (operation: () => Promise<void> | void): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupError ??= error;
        }
      };

      await cleanup(async () => {
        if (!server || !runId || !runningProcesses.has(runId)) return;
        const cancelResponse = await fetch(projectUrl(baseUrl, `/api/v1/jobs/runs/${runId}/cancel`), { method: "POST" });
        expect(cancelResponse.status).toBe(200);
      });
      await cleanup(async () => {
        if (runId) await waitForRunProcessCleanup(runId);
      });
      await cleanup(() => restoreRuntime?.());
      await cleanup(() => vault.sealVault());
      await cleanup(async () => {
        if (!referenceId || !taskId) return;
        const referenceDelete = await fetch(
          projectUrl(baseUrl, `/api/v1/tasks/${taskId}/references/${referenceId}`),
          { method: "DELETE" },
        );
        expect(referenceDelete.status).toBe(204);
      });
      await cleanup(async () => {
        if (!taskId) return;
        const taskDelete = await fetch(projectUrl(baseUrl, `/api/v1/tasks/${taskId}`), { method: "DELETE" });
        expect(taskDelete.status).toBe(204);
      });
      await cleanup(async () => {
        if (!jobId) return;
        const jobDelete = await fetch(projectUrl(baseUrl, `/api/v1/jobs/${jobId}`), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected_revision: 0 }),
        });
        expect(jobDelete.status).toBe(204);
      });
      await cleanup(async () => {
        if (!projectCreated) return;
        const projectDelete = await fetch(`${baseUrl}/api/v1/projects/${projectName}`, { method: "DELETE" });
        expect(projectDelete.status).toBe(200);
      });
      await cleanup(async () => {
        if (server?.listening) await closeServer(server);
      });
      await cleanup(() => resetDbForTest());
      await cleanup(() => {
        rmSync(directory, { recursive: true, force: true });
        expect(existsSync(directory)).toBe(false);
      });
      restoreEnvironment(originalEnvironment);
      if (cleanupError) throw cleanupError;
    }
  }, 15_000);
});
