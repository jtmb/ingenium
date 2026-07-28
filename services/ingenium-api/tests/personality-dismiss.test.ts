import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { personality, projects, resetDbForTest } from "ingenium-core";
import { personalityRouter } from "../lib/routes/personality.js";

let tempDir = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

async function startPersonalityRouter(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/personality", personalityRouter);
  server = createServer(app);
  return await new Promise<string>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
    });
  });
}

describe("POST /personality/:id/dismiss ownership", () => {
  it("dismisses an owned trait and rejects foreign or missing traits without mutating them", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-personality-dismiss-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    const owner = projects.createProject("dismiss-owner");
    const external = projects.createProject("dismiss-external");
    const ownedTrait = personality.upsertTrait(
      owner.id,
      "code_preference",
      "owned-dismiss-trait",
      "Owned trait",
      0.6,
    );
    const externalTrait = personality.upsertTrait(
      external.id,
      "code_preference",
      "external-dismiss-trait",
      "External trait",
      0.6,
    );
    const baseUrl = await startPersonalityRouter();

    const ownedResponse = await fetch(
      `${baseUrl}/personality/${ownedTrait.id}/dismiss?project=${owner.name}`,
      { method: "POST" },
    );
    expect(ownedResponse.status).toBe(200);
    await expect(ownedResponse.json()).resolves.toEqual({ data: { id: ownedTrait.id } });
    expect(personality.listTraits(owner.id, true).find((trait) => trait.id === ownedTrait.id)).toMatchObject({
      id: ownedTrait.id,
      is_active: 0,
    });

    const foreignResponse = await fetch(
      `${baseUrl}/personality/${externalTrait.id}/dismiss?project=${owner.name}`,
      { method: "POST" },
    );
    expect(foreignResponse.status).toBe(404);
    expect(personality.listTraits(external.id, true).find((trait) => trait.id === externalTrait.id)).toMatchObject({
      id: externalTrait.id,
      is_active: 1,
    });

    const missingResponse = await fetch(
      `${baseUrl}/personality/999999/dismiss?project=${owner.name}`,
      { method: "POST" },
    );
    expect(missingResponse.status).toBe(404);
  });
});
