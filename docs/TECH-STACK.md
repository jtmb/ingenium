# Tech Stack

## Languages

| Language | Used for | Why |
|----------|----------|-----|
| **Bash** (5.x+) | Bootstrap scripts, test suite | Universal availability, no runtime deps, POSIX-compatible |
| **Markdown** | All skill bodies (SKILL.md), all documentation | Universal format, AI-native, rendered on GitHub/GitLab |
| **YAML** | Skill frontmatter (`name`, `description`) | Human-readable, strict syntax prevents silent failures |
| **JSON** | Hooks (`session-start.json`, `pre-tool-use.json`, `post-tool-use.json`) | Deterministic, machine-enforced |
| **Mermaid** | Architecture & flow diagrams in README.md and docs | Renders on GitHub without external deps |

## Frameworks

**None.** The project intentionally has zero framework dependencies. It operates as pure files — Markdown + YAML + Bash — so it can bootstrap into any target project regardless of its tech stack.

## Key Dependencies

| Dependency | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **bash** | ≥5.0 | Script execution | `inherit_errexit` (default ON in 5.x) needed for test suite |
| **git** | any | Version control | Commit hashes for learnings.md changelog |
| **find** | any | Test suite file enumeration | Standard POSIX utility |
| **grep** | any | Pattern matching in tests | Standard POSIX utility |
| **sed** | any | Text processing | Standard POSIX utility |

The `package.json` at the project root contains entries like `solidjs`, `astro`, `pino`, and `bullmq` — but these are **never installed**. They exist solely to provide a dependency list that the `test-self-improving.sh` gap detection (Signal 1) can validate against. The test asserts that these deps correctly trigger "NO matching skill" detection.

## Development Tools

| Tool | Used for |
|------|----------|
| **shellcheck** (optional) | Linting bootstrap and test scripts |
| **git** | Version control, conventional commits |
| **VS Code** | Primary editor — the skill system targets VS Code Copilot/Cline |

## Infrastructure

None. This is a file-based toolkit. There is no server, no database, no deployment infrastructure.

## Version Policy

- **Bash**: Must be ≥5.0 for `inherit_errexit` behavior. Earlier versions will fail tests silently.
- **git**: Any version supporting conventional commits.
- **No pinned versions** — the project has no runtime dependencies to pin. `package.json` is a test fixture, not an install manifest.
