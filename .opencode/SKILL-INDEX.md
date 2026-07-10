# SKILL-INDEX.md — Skill Catalog

This file lists all skills in the Ingenium system. It is auto-generated from `.opencode/skills/*/SKILL.md` files but can be manually updated when adding new skills.

**Total Skills:** 14

| Name | Description |
|------|-------------|
| configuring-opencode | OpenCode configuration management and customization |
| database-conventions | Database design patterns, SQL conventions, and optimization strategies |
| debugging-patterns | Debugging methodologies, error interpretation, and self-correction techniques |
| development-conventions | Unified development conventions — README creation, API design, Next.js 16 App Router, and Python conventions |
| devops-conventions | DevOps conventions for Docker, Kubernetes, CLI tools, and infrastructure |
| github-cli | GitHub operations including releases, gists, search, PRs, and issues |
| ingenium-ops | Ingenium system operations and maintenance procedures |
| language-conventions | Programming language conventions and best practices |
| local-models | Local LLM deployment, command safety, and model profiles |
| mcp-tooling | MCP server configuration, Playwright automation, and Thread integration |
| onboard-existing-repo | Onboarding existing repositories into the Ingenium system |
| orchestrator-primer | Orchestrator agent patterns and workflow management |
| self-learning | Self-learning pipeline with observation, synthesis, and personality systems |
| skill-maintenance | Create, update, retire, index, and audit skills as projects evolve |

## Maintenance

This file should be regenerated using `/update-skill-index` command or by running:

```bash
# List all skills in directory
ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||' | sort

# Verify each has a SKILL.md
for skill in $(ls -d .opencode/skills/*/ | sed 's|.*/||;s|/||'); do
  if [ ! -f ".opencode/skills/$skill/SKILL.md" ]; then
    echo "Missing: $skill"
  fi
done
```

## Adding New Skills

When adding a new skill:

1. Create directory `.opencode/skills/<name>/`
2. Write `SKILL.md` with YAML frontmatter (name, description)
3. Add entry to this file in the table above
4. Run `/update-skill-index` to regenerate

## Related Documentation

- [docs/HOW-TO/skills.md](./HOW-TO/skills.md) — Skill system usage guide
- [AGENTS.md](./AGENTS.md) — Agent protocol and mandatory skills
- [docs/CONVENTIONS.md](./CONVENTIONS.md) — Development conventions
