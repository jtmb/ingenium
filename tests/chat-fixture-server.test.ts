import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { get } from "node:http";
import {
  closeChatFixtureServer,
  getFixturePort,
  installFixtureSignalHandlers,
  startChatFixtureServer,
} from "./chat-fixture-server";

function listeningPort(server: { address(): string | import("node:net").AddressInfo | null }): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind a TCP port");
  return address.port;
}

afterEach(() => vi.unstubAllEnvs());

describe("chat fixture lifecycle", () => {
  it("validates its port and publishes the native split model catalog", async () => {
    expect(getFixturePort({ CHAT_FIXTURE_PORT: "45211" })).toBe(45211);
    expect(() => getFixturePort({ CHAT_FIXTURE_PORT: "4999x" })).toThrow();

    const server = await startChatFixtureServer(0);
    try {
      const port = listeningPort(server);
      const response = await fetch(`http://127.0.0.1:${port}/api/provider`);
      const body = await response.json() as { data: Array<{ id: string }> };
      expect(response.status).toBe(200);
      expect(body.data[0]!.id).toBe("opencode");
      const models = await (await fetch(`http://127.0.0.1:${port}/api/model`)).json();
      expect(models.data).toEqual([expect.objectContaining({ modelID: "fixture-model", providerID: "opencode" })]);
      expect((await fetch(`http://127.0.0.1:${port}/provider`)).status).toBe(404);
    } finally {
      await closeChatFixtureServer(server);
    }
  });

  it("returns the native OpenCode server identity contract", async () => {
    const server = await startChatFixtureServer(0);
    try {
      const port = listeningPort(server);
      const response = await fetch(`http://127.0.0.1:${port}/api/info`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ version: "2.0.11" });
    } finally {
      await closeChatFixtureServer(server);
    }
  });

  it("returns the deployed 404 contract for messages from an unknown session", async () => {
    const server = await startChatFixtureServer(0);
    try {
      const port = listeningPort(server);
      const response = await fetch(`http://127.0.0.1:${port}/api/session/missing-session/message`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: { message: "Not found", code: "NOT_FOUND" },
      });
    } finally {
      await closeChatFixtureServer(server);
    }
  });

  it("resets session state only for the manifest-bound fixture runner", async () => {
    const nonce = "10000000-0000-4000-8000-000000000108";
    vi.stubEnv("CHAT_FIXTURE_RUNNER", "1");
    vi.stubEnv("INGENIUM_TEST_RUN_NONCE", nonce);
    const server = await startChatFixtureServer(0);
    try {
      const port = listeningPort(server);
      const first = await (await fetch(`http://127.0.0.1:${port}/api/session`, { method: "POST", body: "{}" })).json();
      expect((await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).data).toHaveLength(1);
      expect((await fetch(`http://127.0.0.1:${port}/__fixture/reset`, { method: "POST" })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/__fixture/reset`, {
        method: "POST",
        headers: { "x-ingenium-fixture-run-nonce": nonce },
      })).status).toBe(204);
      expect(await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).toEqual({ data: [], cursor: {} });
      const next = await (await fetch(`http://127.0.0.1:${port}/api/session`, { method: "POST", body: "{}" })).json();
      expect(next.data.id).not.toBe(first.data.id);
    } finally {
      await closeChatFixtureServer(server);
    }
  });

  it("binds sessions to their location and emits native events only after a prompt", async () => {
    const server = await startChatFixtureServer(0);
    const base = `http://127.0.0.1:${listeningPort(server)}`;
    const controller = new AbortController();
    try {
      const created = await (await fetch(`${base}/api/session`, {
        method: "POST", body: JSON.stringify({ location: { directory: "/fixture/owned" }, title: "Native fixture" }),
      })).json();
      const session = created.data;
      expect(session).toMatchObject({ location: { directory: "/fixture/owned" }, title: "Native fixture" });
      expect((await (await fetch(`${base}/api/session?directory=/other`)).json()).data).toEqual([]);
      expect((await (await fetch(`${base}/api/session?directory=/fixture/owned`)).json()).data).toEqual([session]);
      expect((await fetch(`${base}/api/session/${session.id}`, {
        method: "PATCH", body: JSON.stringify({ title: "Renamed native fixture" }),
      })).status).toBe(204);
      expect((await (await fetch(`${base}/api/session/${session.id}`)).json()).data.title).toBe("Renamed native fixture");
      expect((await (await fetch(`${base}/api/session/${session.id}/message`)).json()).data).toEqual([]);
      const stream = await fetch(`${base}/api/event`, { signal: controller.signal });
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toBe(": connected\n\n");
      const admitted = await (await fetch(`${base}/api/session/${session.id}/prompt`, {
        method: "POST", body: JSON.stringify({ text: "Synthetic native prompt", metadata: { ingeniumVisibleText: "Visible prompt" } }),
      })).json();
      expect(admitted.data).toMatchObject({ type: "user", text: "Synthetic native prompt" });
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('"type":"session.next.step.started"');
      expect(first).toContain(`"sessionID":"${session.id}"`);
      const history = await (await fetch(`${base}/api/session/${session.id}/message`)).json();
      expect(history.data).toEqual([admitted.data]);
      await reader.cancel();
    } finally {
      controller.abort();
      await closeChatFixtureServer(server);
    }
  });

  it("destroys active SSE sockets without waiting for the stream delays", async () => {
    const server = await startChatFixtureServer(0);
    const port = listeningPort(server);
    let responseClosed = false;
    let responseStarted!: () => void;
    const responseReady = new Promise<void>((resolve) => { responseStarted = resolve; });
    let responseFinished!: () => void;
    const responseClosedReady = new Promise<void>((resolve) => { responseFinished = resolve; });
    const request = get(`http://127.0.0.1:${port}/api/event`, (response) => {
      responseStarted();
      response.on("data", () => undefined);
      response.on("close", () => { responseClosed = true; responseFinished(); });
    });
    try {
      await responseReady;
      const started = Date.now();
      await closeChatFixtureServer(server, 1_000);
      await Promise.race([
        responseClosedReady,
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(responseClosed || request.destroyed).toBe(true);
    } finally {
      request.destroy();
    }
  });

  it("shuts down on SIGINT/SIGTERM through one idempotent signal path", async () => {
    const server = await startChatFixtureServer(0);
    const signalSource = new EventEmitter();
    const exit = vi.fn();
    const remove = installFixtureSignalHandlers(server, signalSource, exit);

    signalSource.emit("SIGINT");
    signalSource.emit("SIGTERM");
    for (let attempt = 0; attempt < 20 && server.listening; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(server.listening).toBe(false);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
    remove();
  });
});
