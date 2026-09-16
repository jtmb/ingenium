import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observations,
  personality,
  projects,
  resetDbForTest,
} from "ingenium-core";
import { observationsRouter } from "../lib/routes/observations.js";
import { personalityRouter } from "../lib/routes/personality.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let tempDir = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

afterEach(async () => {
  if (server) await closeHttpServer(server);
  server = undefined;
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

async function startLearningRoutes(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/observations", observationsRouter);
  app.use("/personality", personalityRouter);
  server = createServer(app);
  return listenOnLoopback(server);
}

describe("learning route ownership", () => {
  it("rejects unsupported observation sources before persistence and accepts valid sources", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-observation-source-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    const project = projects.createProject("observation-source-route-project");
    const baseUrl = await startLearningRoutes();

    const invalid = await fetch(`${baseUrl}/observations?project=${project.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observation_type: "correction",
        content: "Reject invalid provenance",
        source: "explicit-user-correction",
      }),
    });
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(observations.getObservations(project.id)).toHaveLength(0);

    const valid = await fetch(`${baseUrl}/observations?project=${project.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observation_type: "correction",
        content: "Keep valid provenance",
        source: "manual",
      }),
    });
    expect(valid.status).toBe(201);
    await expect(valid.json()).resolves.toMatchObject({ data: { source: "manual" } });
    expect(observations.getObservations(project.id)).toHaveLength(1);
  });

  it("does not expose or mutate observations and traits from another project", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-learning-ownership-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    const owner = projects.createProject("owner-project");
    const external = projects.createProject("external-project");
    const externalObservation = observations.storeObservation(
      external.id,
      "preference",
      "External project observation",
      8,
    );
    const externalTrait = personality.upsertTrait(
      external.id,
      "code_preference",
      "external-project-trait",
      "External project trait",
      0.6,
    );
    const baseUrl = await startLearningRoutes();

    const getResponse = await fetch(
      `${baseUrl}/observations/${externalObservation.id}?project=${owner.name}`,
    );
    expect(getResponse.status).toBe(404);

    const updateResponse = await fetch(
      `${baseUrl}/observations/${externalObservation.id}?project=${owner.name}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processed" }),
      },
    );
    expect(updateResponse.status).toBe(404);
    expect(observations.getObservation(external.id, externalObservation.id)).toMatchObject({
      project_id: external.id,
      status: "pending",
    });

    const disableResponse = await fetch(
      `${baseUrl}/personality/${externalTrait.id}/disable?project=${owner.name}`,
      { method: "POST" },
    );
    expect(disableResponse.status).toBe(404);
    expect(personality.getTraits(external.id).find((trait) => trait.id === externalTrait.id)).toMatchObject({
      project_id: external.id,
      is_active: 1,
    });

    const ownerTrait = personality.upsertTrait(
      owner.id,
      "code_preference",
      "owner-project-trait",
      "Owner project trait",
      0.6,
    );
    const ownerDisableResponse = await fetch(
      `${baseUrl}/personality/${ownerTrait.id}/disable?project=${owner.name}`,
      { method: "POST" },
    );
    expect(ownerDisableResponse.status).toBe(204);
    expect(personality.getTraits(owner.id).find((trait) => trait.id === ownerTrait.id)).toBeUndefined();
  });
});
