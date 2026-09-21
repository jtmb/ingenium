import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode/plugin";

/**
 * Ponytail V2 adapter.
 *
 * The vendored Ponytail checkout keeps its V1 plugin entrypoint at
 * `ponytail/.opencode/plugins/ponytail.mjs` and remains byte-for-byte upstream
 * (see `ponytail/PROVENANCE.md`). V2 does not run V1 plugin implementations, so
 * this adapter re-implements the same three behaviors through the V2 plugin
 * context:
 *
 *  - `config.command` registration       → `ctx.command.transform`
 *  - `config.skills.paths` registration  → `ctx.skill.transform`
 *  - `experimental.chat.system.transform`→ `ctx.session.hook("context")`
 *
 * Module state (`.ponytail-active`) stays in the same location the vendored
 * helpers read so V1 and V2 sessions observe one mode.
 */

const BROKER_MARKER = "This agent is reserved for system use. Do not invoke directly.";

const here = dirname(fileURLToPath(import.meta.url));
const ponytailRoot = [
  resolve(here, "../../../ponytail"),
  resolve(here, "../../../../ponytail"),
].find((candidate) => existsSync(join(candidate, "package.json")));
if (ponytailRoot === undefined) throw new Error("PONYTAIL_ROOT_UNAVAILABLE");

const require = createRequire(import.meta.url);
const { getPonytailInstructions } = require(join(ponytailRoot, "hooks/ponytail-instructions.js")) as {
  getPonytailInstructions: (mode: string) => string;
};
const { getDefaultMode, normalizePersistedMode } = require(join(ponytailRoot, "hooks/ponytail-config.js")) as {
  getDefaultMode: () => string;
  normalizePersistedMode: (mode: string) => string | null;
};
const { parseCommandFile } = require(join(ponytailRoot, ".opencode/plugins/ponytail-frontmatter.cjs")) as {
  parseCommandFile: (path: string) => { description?: string; template: string } | null;
};

const statePath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "opencode",
  ".ponytail-active",
);

function readMode(): string {
  try {
    return normalizePersistedMode(readFileSync(statePath, "utf8").trim()) || getDefaultMode();
  } catch {
    return getDefaultMode();
  }
}

function writeMode(mode: string): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, mode);
}

interface CommandFile {
  name: string;
  description?: string;
  template: string;
}

function readCommands(): CommandFile[] {
  const directory = join(ponytailRoot as string, ".opencode", "command");
  const commands: CommandFile[] = [];
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".md"))) {
    const parsed = parseCommandFile(join(directory, file));
    if (!parsed) continue;
    commands.push({
      name: basename(file, ".md"),
      ...(parsed.description === undefined ? {} : { description: parsed.description }),
      template: parsed.template,
    });
  }
  return commands;
}

interface SkillFile {
  id: string;
  name: string;
  description?: string;
  path: string;
  content: string;
}

/** Parse `SKILL.md` frontmatter just enough for name/description registration. */
function parseSkill(file: string): SkillFile | undefined {
  const raw = readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return undefined;
  const front = match[1] as string;
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (!name) return undefined;

  let description = front.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (description === ">" || description === "|") {
    const lines = front.split(/\r?\n/);
    const start = lines.findIndex((line) => /^description:\s*[>|]\s*$/.test(line));
    const collected: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (!/^\s+\S/.test(line)) break;
      collected.push(line.trim());
    }
    description = collected.join(" ");
  }

  return {
    id: name,
    name,
    ...(description === undefined || description === "" ? {} : { description }),
    path: file,
    content: (match[2] as string).trim(),
  };
}

function readSkills(): SkillFile[] {
  const directory = join(ponytailRoot as string, "skills");
  const skills: SkillFile[] = [];
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry, "SKILL.md");
    if (!existsSync(file)) continue;
    const skill = parseSkill(file);
    if (skill) skills.push(skill);
  }
  return skills;
}

const setup = async (ctx: Plugin.Context) => {
  const commands = readCommands();
  if (commands.length > 0) {
    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add({
          name: command.name,
          ...(command.description === undefined ? {} : { description: command.description }),
          execute: async ({ sessionID, prompt, delivery }) => {
            const args = typeof prompt.text === "string" ? prompt.text.trim() : "";
            if (command.name === "ponytail") {
              const mode = args ? normalizePersistedMode(args) : getDefaultMode();
              if (mode) writeMode(mode);
            }
            const text = command.template.replaceAll("$ARGUMENTS", args).trim();
            await ctx.session.prompt({ ...prompt, sessionID, text, delivery });
          },
        });
      }
    });
  }

  const skills = readSkills();
  if (skills.length > 0) {
    await ctx.skill.transform((editor) => {
      for (const skill of skills) {
        editor.add({
          id: skill.id,
          name: skill.name,
          ...(skill.description === undefined ? {} : { description: skill.description }),
          path: skill.path,
          content: skill.content,
        } as never);
      }
    });
  }

  await ctx.session.hook("context", (event) => {
    // The protected broker supplies this canonical prompt marker; never inject.
    if (event.system.some((part) => part.type === "text" && part.text.includes(BROKER_MARKER))) return;
    const mode = readMode();
    if (mode === "off") return;
    event.system.push({ type: "text", text: getPonytailInstructions(mode) });
  });
};

export default { id: "ponytail", setup } satisfies Plugin.Plugin;
