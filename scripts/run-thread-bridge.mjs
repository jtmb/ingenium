#!/usr/bin/env node

import { spawn } from "node:child_process";

const bridge = spawn(
  "/opt/thread/venv/bin/python",
  ["-m", "thread_bridge.bridge"],
  {
    cwd: "/opt/thread/src",
    // Deliberately do not inherit the OpenCode environment: the bridge only
    // needs the fixed internal endpoint and must not receive credentials.
    env: { THREAD_SERVER_URL: "http://thread:5000" },
    shell: false,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    bridge.kill(signal);
  });
}

bridge.once("error", (error) => {
  process.stderr.write(`Unable to start Thread bridge: ${error.message}\n`);
  process.exit(1);
});

bridge.once("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
