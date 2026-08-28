import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  GET_ALL_PROCESS_INFO_XML,
  parseSupervisorProcesses,
  supervisorRpc,
} from "../lib/supervisor-client.js";

const originalServerUrl = process.env.SUPERVISOR_SERVER_URL;
const servers: Server[] = [];
const directories: string[] = [];

function response(name = "ingenium-api", state = "RUNNING"): string {
  return `<methodResponse><params><param><value><array><data><value><struct>
    <member><name>name</name><value><string>${name}</string></value></member>
    <member><name>statename</name><value><string>${state}</string></value></member>
    <member><name>start</name><value><i4>10</i4></value></member>
    <member><name>now</name><value><i4>20</i4></value></member>
    <member><name>spawnerr</name><value><string></string></value></member>
    <member><name>pid</name><value><i4>42</i4></value></member>
    <member><name>exitstatus</name><value><i4>0</i4></value></member>
    <member><name>stop</name><value><i4>0</i4></value></member>
  </struct></value></data></array></value></param></params></methodResponse>`;
}

function rpcServer(body?: string): Server {
  const server = createServer((request, reply) => {
    request.resume();
    request.on("end", () => {
      if (body === undefined) return;
      reply.writeHead(200, { "Content-Type": "text/xml" });
      reply.end(body);
    });
  });
  servers.push(server);
  return server;
}

async function listen(server: Server, target: string | number): Promise<void> {
  await new Promise<void>((resolve) => server.listen(target, typeof target === "number" ? "127.0.0.1" : undefined, resolve));
}

afterEach(async () => {
  if (originalServerUrl === undefined) delete process.env.SUPERVISOR_SERVER_URL;
  else process.env.SUPERVISOR_SERVER_URL = originalServerUrl;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("supervisorRpc", () => {
  it("queries Supervisor through an explicitly configured Unix socket", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-supervisor-client-"));
    directories.push(directory);
    const socketPath = join(directory, "supervisor.sock");
    await listen(rpcServer(response()), socketPath);
    process.env.SUPERVISOR_SERVER_URL = `unix://${socketPath}`;

    const processes = parseSupervisorProcesses(await supervisorRpc(GET_ALL_PROCESS_INFO_XML));

    expect(processes).toEqual([expect.objectContaining({ name: "ingenium-api", statename: "RUNNING", start: 10, now: 20, pid: 42 })]);
  });

  it("supports loopback TCP only when explicitly configured", async () => {
    const server = rpcServer(response());
    await listen(server, 0);
    const port = (server.address() as AddressInfo).port;
    process.env.SUPERVISOR_SERVER_URL = `http://127.0.0.1:${port}/RPC2`;

    await expect(supervisorRpc(GET_ALL_PROCESS_INFO_XML)).resolves.toContain("<methodResponse>");
  });

  it("rejects non-loopback TCP configuration", async () => {
    process.env.SUPERVISOR_SERVER_URL = "http://example.com/RPC2";

    await expect(supervisorRpc(GET_ALL_PROCESS_INFO_XML, 20)).rejects.toThrow("Supervisor RPC unavailable");
  });

  it("fails safely when the Unix socket is missing", async () => {
    process.env.SUPERVISOR_SERVER_URL = "unix:///tmp/ingenium-supervisor-missing.sock";

    await expect(supervisorRpc(GET_ALL_PROCESS_INFO_XML, 20)).rejects.toThrow("Supervisor RPC unavailable");
  });

  it("times out with a content-free error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ingenium-supervisor-timeout-"));
    directories.push(directory);
    const socketPath = join(directory, "supervisor.sock");
    await listen(rpcServer(), socketPath);
    process.env.SUPERVISOR_SERVER_URL = `unix://${socketPath}`;

    await expect(supervisorRpc(GET_ALL_PROCESS_INFO_XML, 20)).rejects.toThrow("Supervisor RPC unavailable");
  });

  it("rejects malformed XML-RPC responses without reflecting content", async () => {
    expect(() => parseSupervisorProcesses("not XML and potentially sensitive")).toThrow("Supervisor RPC unavailable");
  });
});
