#!/usr/bin/env node
import { execFile } from "node:child_process";
import { chmodSync, chownSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { promisify } from "node:util";

const socketPath = "/run/ingenium-restore-handoff/request.sock";
const apiGid = 1101;
const run = promisify(execFile);

rmSync(socketPath, { force: true });

const server = createServer((connection) => {
  let request = "";
  connection.setEncoding("utf8");
  connection.setTimeout(2_000, () => connection.destroy());
  connection.on("data", (chunk) => {
    request += chunk;
    if (request.length > 1) connection.destroy();
  });
  connection.on("end", async () => {
    if (request !== "1") {
      connection.end("error");
      return;
    }
    try {
      await run("supervisorctl", ["-c", "/app/supervisord.conf", "start", "restore-maintenance"], { timeout: 5_000 });
      connection.end("ok");
    } catch (error) {
      const text = `${error instanceof Error ? error.message : ""} ${error && typeof error === "object" && "stderr" in error ? error.stderr : ""}`;
      connection.end(text.includes("ALREADY_STARTED") ? "ok" : "error");
    }
  });
});

server.listen(socketPath, () => {
  chownSync(socketPath, process.getuid(), apiGid);
  chmodSync(socketPath, 0o620);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
