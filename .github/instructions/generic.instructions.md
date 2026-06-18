---
description: "Fallback conventions for any project without a specific framework overlay. Enforces core rules from AGENTS.md."
applyTo: "**"
---

# Generic Project Conventions

This instruction fires for files that don't match a specific framework overlay. It enforces the core rules from `AGENTS.md`:

## Always Follow

1. **Read AGENTS.md** — the `.github/instructions/always-read-agents.instructions.md` instruction forces this before every code change.

2. **Write comments** — every function, class, and non-obvious block needs a human-readable comment explaining why and what.

3. **Keep docs in sync** — every code change updates `docs/` at the repo root.

4. **Test before done** — lint, build, test, manual smoke test before claiming completion.

5. **Don't repeat yourself** — extract shared logic into designated utility/helper locations.

## Framework-Specific Rules

If this project uses a framework with its own `.github/instructions/{name}.instructions.md` file but your file isn't matching, check the `applyTo` glob in that file. To add framework support, see `USAGE.md` → "Add a New Framework Overlay."

## Build & Test

- Use the project's build system (Makefile, CMake, build scripts, etc.)
- Check `docs/TECH-STACK.md` for configured tools and commands
- If no test framework exists, add one before writing significant logic
