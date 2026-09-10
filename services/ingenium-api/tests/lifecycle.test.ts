import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { createApiLifecycle, installShutdownSignalHandlers, type LifecycleDependencies } from "../lib/lifecycle.js";
import {
  isApiTestMode,
  shouldStartBackgroundSchedulers,
  shouldStartMailMaintenance,
} from "../lib/runtime-mode.js";

let server: Server | undefined;

async function listen(): Promise<Server> {
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return server;
}

async function closeServer(): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
}

function dependencies(calls: string[]): LifecycleDependencies {
  const stop = (name: string) => async () => {
    calls.push(name);
  };
  return {
    stopScheduler: stop("scheduler"),
    stopBackupScheduler: stop("backup"),
    stopJobs: stop("jobs"),
    stopMailWatchers: stop("watchers"),
    stopMailEngine: stop("mail-engine"),
  };
}

afterEach(async () => {
  await closeServer();
  server = undefined;
});

describe("API lifecycle", () => {
  it("closes the listener and stops every owned background subsystem exactly once", async () => {
    const calls: string[] = [];
    const lifecycle = createApiLifecycle(await listen(), dependencies(calls));
    lifecycle.registerCleanup("startup-mail-timer", () => calls.push("startup-mail-timer"));

    const first = lifecycle.shutdown("SIGTERM");
    const second = lifecycle.shutdown("SIGINT");
    const result = await first;

    expect(second).toBe(first);
    expect(result).toEqual({ status: "completed", reason: "SIGTERM" });
    expect(server!.listening).toBe(false);
    expect(calls).toEqual(expect.arrayContaining([
      "scheduler",
      "backup",
      "jobs",
      "watchers",
      "mail-engine",
      "startup-mail-timer",
    ]));
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("bounds a stalled cleanup without calling process.exit", async () => {
    const calls: string[] = [];
    const stalled: LifecycleDependencies = {
      ...dependencies(calls),
      stopScheduler: () => new Promise<void>(() => {}),
    };
    const lifecycle = createApiLifecycle(await listen(), stalled, { shutdownTimeoutMs: 20 });

    await expect(lifecycle.shutdown("SIGTERM")).resolves.toEqual({
      status: "timed_out",
      reason: "SIGTERM",
    });
    expect(server!.listening).toBe(false);
  });

  it("handles signals through the lifecycle and sets an exit code only after cleanup", async () => {
    const calls: string[] = [];
    const lifecycle = createApiLifecycle(await listen(), dependencies(calls));
    const processRef = new EventEmitter() as EventEmitter & { exitCode?: number };
    const dispose = installShutdownSignalHandlers(lifecycle, processRef);

    processRef.emit("SIGTERM");
    await vi.waitFor(() => expect(server!.listening).toBe(false));
    await vi.waitFor(() => expect(processRef.exitCode).toBe(0));

    expect(calls).toContain("scheduler");
    dispose();
  });
});

describe("API runtime modes", () => {
  it("disables schedulers and mail maintenance in explicit test mode", () => {
    const environment = { INGENIUM_API_TEST_MODE: "true" } as NodeJS.ProcessEnv;

    expect(isApiTestMode(environment)).toBe(true);
    expect(shouldStartBackgroundSchedulers(environment)).toBe(false);
    expect(shouldStartMailMaintenance(environment)).toBe(false);
  });

  it("keeps production maintenance enabled unless an explicit switch disables it", () => {
    expect(shouldStartBackgroundSchedulers({ NODE_ENV: "production" })).toBe(true);
    expect(shouldStartMailMaintenance({ NODE_ENV: "production" })).toBe(true);
    expect(shouldStartBackgroundSchedulers({ INGENIUM_API_DISABLE_SCHEDULERS: "1" })).toBe(false);
    expect(shouldStartMailMaintenance({ INGENIUM_API_DISABLE_MAIL_MAINTENANCE: "true" })).toBe(false);
  });
});
