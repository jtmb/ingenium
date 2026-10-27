import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

/** Link declared installed externals into a run-owned compiled fixture; never copy dependency trees. */
export function linkRuntimeDependencyFixture(workspaceRoots: string[], packageDirectory: string): void {
  const localWorkspaces = new Set(["ingenium-core", "ingenium-email", "ingenium-api", "ingenium-server", "@ingenium/extension"]);
  for (const workspaceRoot of workspaceRoots) {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));
    const fromWorkspace = createRequire(join(workspaceRoot, "package.json"));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (localWorkspaces.has(name)) continue;
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error("Invalid fixture dependency name");
      const destination = join(packageDirectory, "node_modules", name);
      if (existsSync(destination)) continue;
      const packageRoot = (fromWorkspace.resolve.paths(name) ?? [])
        .map((directory) => join(directory, name))
        .find((directory) => existsSync(join(directory, "package.json")));
      if (!packageRoot) throw new Error(`Missing declared fixture dependency: ${name}`);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(packageRoot, destination, "dir");
    }
  }
}
