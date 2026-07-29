#!/usr/bin/env node

import { runThreadBridge } from "./thread-bridge-guard.mjs";

// The pinned official Python bridge remains the upstream implementation. This
// process is the public child-MCP boundary and deliberately gives it only the
// fixed internal Thread endpoint.
runThreadBridge({
  command: "/opt/thread/venv/bin/python",
  args: ["-m", "thread_bridge.bridge"],
  cwd: "/opt/thread/src",
  env: { THREAD_SERVER_URL: "http://thread:5000" },
});
