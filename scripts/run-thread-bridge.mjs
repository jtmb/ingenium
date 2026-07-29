#!/usr/bin/env node

import { runThreadBridge } from "./thread-bridge-guard.mjs";

// This is a local stdio MCP child, not a Thread client. It can reach only the
// guard's bounded frontend protocol; the official Python bridge lives solely in
// the thread-guard container on the separate backend network.
runThreadBridge({
  guardUrl: "http://thread-guard:8081/v1/call",
});
