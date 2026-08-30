import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const credentialPaths = [
  ".opencode/.ingenium-learning-credential",
  ".opencode/.ingenium-coordination-owner-provider.json",
];

function activePatterns(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("learning credential packaging boundary", () => {
  it("excludes the protected credential from Git, npm, and Docker COPY context", () => {
    const gitignore = activePatterns(join(repositoryRoot, ".gitignore"));
    const dockerignore = activePatterns(join(repositoryRoot, ".dockerignore"));
    const dockerfile = readFileSync(join(repositoryRoot, "Dockerfile"), "utf8");
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "packages/ingenium-extension/package.json"), "utf8")) as {
      files?: string[];
    };
    for (const credentialPath of credentialPaths) {
      const ignored = spawnSync("git", ["check-ignore", "--no-index", "--quiet", credentialPath], {
        cwd: repositoryRoot,
      });
      expect(ignored.status).toBe(0);
      expect(gitignore).toContain(credentialPath);
      expect(dockerignore).toContain(credentialPath);
      expect(dockerignore).not.toContain(`!${credentialPath}`);
    }
    expect(dockerignore).toContain("**/.opencode/.ingenium-learning-credential");
    expect(dockerfile).toContain("COPY . .");
    expect(packageJson.files).toEqual(["dist/", "README.md", "plugin-specs.mjs", "ponytail/"]);
    expect(packageJson.files?.some((path) => path.includes(".opencode"))).toBe(false);
  });
});
