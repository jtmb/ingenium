import { describe, expect, it, vi } from "vitest";
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

describe("chat fixture lifecycle", () => {
  it("validates its port and publishes the actual isolated provider origin", async () => {
    expect(getFixturePort({ CHAT_FIXTURE_PORT: "45211" })).toBe(45211);
    expect(() => getFixturePort({ CHAT_FIXTURE_PORT: "4999x" })).toThrow();

    const server = await startChatFixtureServer(0);
    try {
      const port = listeningPort(server);
      const response = await fetch(`http://127.0.0.1:${port}/provider`);
      const body = await response.json() as { all: Array<{ models: Record<string, { api: { url: string } }> }> };
      expect(response.status).toBe(200);
      expect(body.all[0]!.models["fixture-model"]!.api.url).toBe(`http://127.0.0.1:${port}`);
    } finally {
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
    const request = get(`http://127.0.0.1:${port}/event?session=fixture-session-1`, (response) => {
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
