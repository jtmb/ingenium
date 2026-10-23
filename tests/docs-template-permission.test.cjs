const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const root = resolve(__dirname, "..");
const source = readFileSync(resolve(__dirname, "test-agent-validation.sh"), "utf8");

test("Docs grants only the exact next-steps template, retaining sibling and Bash denials", () => {
  const start = source.indexOf('const fs = require("fs");', source.indexOf("run_permission_parity_validation()"));
  const end = source.indexOf("\nNODE", start);
  assert.ok(start >= 0 && end > start, "existing independent permission validator must remain available");
  const result = runInNewContext(`${source.slice(start, end)}\nJSON.stringify({ errors, permission: permissions.get("ingenium-docs") });`, {
    require,
    process: { argv: ["node", "-", resolve(root, ".opencode/agents"), resolve(root, "opencode.json")], exit: () => undefined },
    console: { log: () => undefined, error: () => undefined },
  });
  const { errors, permission } = JSON.parse(result);
  assert.deepEqual(errors, []);
  assert.equal(permission["*"], "deny");
  const template = "next-steps-plan/next-steps-template.md";
  const denied = [["*", "allow"], ["next-steps-plan/**", "deny"]];
  for (const tool of ["edit", "write", "bash"]) {
    const entries = Object.entries(permission[tool]);
    assert.deepEqual(entries, tool === "bash" ? denied : [...denied, [template, "allow"]]);
    // OpenCode uses last-match-wins; the exact ordered map above excludes any broader exception.
    const decision = (file) => entries.filter(([pattern]) =>
      pattern === "*" || pattern === file || (pattern === "next-steps-plan/**" && file.startsWith("next-steps-plan/"))
    ).at(-1)?.[1];
    assert.equal(decision(template), tool === "bash" ? "deny" : "allow");
    for (const sibling of ["other.md", "nested/other.md", "nested/next-steps-template.md", "next-steps-template.md.bak"]) {
      assert.equal(decision(`next-steps-plan/${sibling}`), "deny");
    }
  }
});
