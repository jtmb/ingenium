import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
const checkoutRoot = join(extensionRoot, "ponytail");
const pluginPath = join(checkoutRoot, ".opencode", "plugins", "ponytail.mjs");
const projectPluginPath = "packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs";
const projectPluginSpec = `file://{env:PWD}/${projectPluginPath}`;

const upstreamHashes: Record<string, string> = {
  ".opencode/plugins/ponytail.mjs": "e9e2214149ace3e589a584a27136bf5bd9da558fbad948f8cf1d3bc2c50d3828",
  ".opencode/plugins/ponytail-frontmatter.cjs": "36073b0749a62bebadb22c01b7fc018d063fb20b337591269008051151a1513d",
  "hooks/ponytail-instructions.js": "23c050103f28dbe6bad953ae21d98cd06d720a20f33d4716e9de419f947d495e",
  "hooks/ponytail-config.js": "0a8daf96cf9ac703dc4cb7b5065253567e513c951d60b8eb94a0fe727514aeca",
  "skills/ponytail/SKILL.md": "1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2",
  "skills/ponytail-audit/SKILL.md": "5560b8e383dbe2ddfddc873a1e2bf2e586e23e0cd7d995537482b2315331f6d1",
  "skills/ponytail-debt/SKILL.md": "c84fba75f0ca12bfe83f9a78ea02fd125c5dd3f1fbb18124105a489937f284e6",
  "skills/ponytail-gain/SKILL.md": "24e01d1c9715cb136ba1c4f1e52a95940c0193558b876828e537736480d6408b",
  "skills/ponytail-help/SKILL.md": "2264d1615117b02b0fd5a69ec84cd2757006471a78e4d6c22eed6d581c1d37a4",
  "skills/ponytail-review/SKILL.md": "40df33b58fc6ef889b93585733feb9566b76e9586efa7f376785c1e995197ac0",
  ".opencode/command/ponytail.md": "800919b5c7b53f05e9adb96e5978818f3b5cd9137bc2df35b1575590d5464f14",
  ".opencode/command/ponytail-audit.md": "6278f820b117a6a57e4c0b013906e06fe4719652e6adc4b9a1b868d6bd1ba6f2",
  ".opencode/command/ponytail-debt.md": "ddbadb1f484a1ecc54ed577b80aa3f7b326ccd1ae2a35159652a52221eb31301",
  ".opencode/command/ponytail-gain.md": "33514a67319e30072e1daeef336b4f4af8de31ef25595a23353f0719004189b2",
  ".opencode/command/ponytail-help.md": "3052afd5cc1ea528d9405729b2620d1b81c36ca3287ec1ae964a68d6feb4c178",
  ".opencode/command/ponytail-review.md": "ff09bd42b1d23bd3e3919c6b7ab4710c0a71b04e23c0fc30fb3c1b1b50451485",
  "LICENSE": "fb1bc6909ac3ef82d5c22106e32ef682b0cff66788fa915fb9b53b15c9d2f3ab",
};

describe("Ponytail immutable checkout integration", () => {
  it("uses one canonical local file URL without recursive companion discovery", () => {
    const config = JSON.parse(readFileSync(join(repositoryRoot, "opencode.json"), "utf8")) as { plugin: string[] };
    const configuredPonytail = config.plugin.filter((entry) => entry.includes("ponytail"));

    expect(configuredPonytail).toEqual([projectPluginSpec]);
    expect(config.plugin).toContain("file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts");
    expect(config.plugin).toContain("file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts");
    expect(config.plugin).toContain("file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts");
    expect(config.plugin).not.toContain("@dietrichgebert/ponytail");
    expect(relative(repositoryRoot, pluginPath)).toBe(projectPluginPath);
    const discoveryRoot = join(repositoryRoot, ".opencode", "plugins");
    expect(existsSync(discoveryRoot)).toBe(false);
  });

  it("presents exactly one legacy-loader plugin function and runs its complete local closure", async () => {
    const module = await import(pathToFileURL(pluginPath).href) as Record<string, unknown>;
    const functions = Object.values(module).filter((value): value is (...args: unknown[]) => unknown => typeof value === "function");

    expect(Object.keys(module)).toEqual(["default"]);
    expect(functions).toHaveLength(1);

    const plugin = await functions[0]!({ client: { app: { log: () => undefined } } }) as {
      config: (config: { command?: Record<string, unknown>; skills?: { paths?: string[] } }) => Promise<void>;
      "experimental.chat.system.transform": (input: unknown, output: { system: string[] }) => Promise<void>;
    };
    const config: { command?: Record<string, unknown>; skills?: { paths?: string[] } } = {};
    await plugin.config(config);

    expect(Object.keys(config.command ?? {}).sort()).toEqual([
      "ponytail",
      "ponytail-audit",
      "ponytail-debt",
      "ponytail-gain",
      "ponytail-help",
      "ponytail-review",
    ]);
    expect(config.skills?.paths).toEqual([join(checkoutRoot, "skills")]);

    const output = { system: [] as string[] };
    await plugin["experimental.chat.system.transform"]({}, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain("PONYTAIL MODE ACTIVE — level: full");
  });

  it("preserves each official source file and records its immutable provenance", () => {
    const provenance = readFileSync(join(checkoutRoot, "PROVENANCE.md"), "utf8");

    expect(provenance).toContain("16f29800fd2681bdf24f3eb4ccffe38be3baec6b");
    expect(provenance).toContain("MIT");
    for (const [relativePath, expectedHash] of Object.entries(upstreamHashes)) {
      const filePath = join(checkoutRoot, relativePath);
      expect(existsSync(filePath), relativePath).toBe(true);
      expect(createHash("sha256").update(readFileSync(filePath)).digest("hex"), relativePath).toBe(expectedHash);
      expect(provenance).toContain(expectedHash);
    }
  });

  it("includes the checkout in package and immutable container runtime assets", () => {
    const packageJson = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8")) as {
      files: string[];
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dockerfile = readFileSync(join(repositoryRoot, "Dockerfile"), "utf8");
    const entrypoint = readFileSync(join(repositoryRoot, "scripts", "docker-entrypoint.sh"), "utf8");

    expect(packageJson.files).toContain("ponytail/");
    expect(packageJson.dependencies?.["@dietrichgebert/ponytail"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@dietrichgebert/ponytail"]).toBeUndefined();
    expect(dockerfile).toContain("COPY --from=builder --chown=root:root /app/packages/ingenium-extension/ponytail ./packages/ingenium-extension/ponytail");
    expect(dockerfile).toContain(projectPluginSpec);
    expect(entrypoint).toContain(projectPluginSpec);
  });
});
