import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseMcpTransportParityArguments } from "./verify-mcp-transport-parity.mjs";

const cli = fileURLToPath(new URL("./verify-mcp-transport-parity.mjs", import.meta.url));

test("optional distribution root preserves the default and accepts only a normalized absolute path", () => {
  assert.equal(parseMcpTransportParityArguments([]), undefined);
  assert.equal(parseMcpTransportParityArguments(["--distribution-root", "/tmp/opencode/candidate"]), "/tmp/opencode/candidate");
});

test("invalid CLI arguments fail before reading distribution artifacts", () => {
  for (const args of [
    ["--distribution-root"],
    ["--distribution-root", "relative"],
    ["--distribution-root", "/tmp/../candidate"],
    ["--distribution-root", "/tmp/opencode/candidate", "extra"],
    ["--unknown", "/tmp/opencode/candidate"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1, `Unexpected status for ${JSON.stringify(args)}`);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Expected --distribution-root <absolute normalized path>/);
    assert.doesNotMatch(result.stderr, /MCP transport parity artifact is missing/);
  }
});
