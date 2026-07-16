---
name: documentation-audit-workflow
description: "Systematic documentation audit methodology — agent exploration, issue categorization, and systematic fixes for AGENTS.md and related docs."
alwaysApply: true
tags: ["llm-synthesized", "auto-generated"]
---

# 🔴 HARD RULEs

1. **Always run agent exploration FIRST** before making documentation updates
2. **Categorize issues by type**: tool counts, Docker processes, mandatory skills, missing commands, environment variables, file paths
3. **Verify changes with read-back** after applying fixes
4. **Track line count growth** to measure audit impact
5. **Use specific LLM models** for exploration (e.g., qwen/qwen3.5-9b)

## 📋 Audit Process

### Phase 1: Exploration
```
# Deploy exploration agents with specific scopes
genius-agent --mode explore --target AGENTS.md --llm qwen/qwen3.5-9b

# Collect findings on:
- Tool count discrepancies (48→56)
- Docker process mismatches (3→4)
- Dead mandatory skills
- Missing commands
- File fallback paths
- Environment variables
```

### Phase 2: Categorization
```
# Group issues by category
tool_issues:
  - count_mismatch: true
  - dead_skills: 4
  - missing_commands: 4

process_issues:
  - docker_processes: 3→4

file_issues:
  - fallback_paths: fixed
  - env_vars_added: 10+
```

### Phase 3: Application & Verification
```
# Apply fixes systematically
genius-agent --mode update --target AGENTS.md --apply findings

# Verify with read-back
genius-agent --mode verify --target AGENTS.md
```

## 🎯 Issue Types to Track

| Type | Examples | Priority |
|------|----------|----------|
| Tool Count | 48→56, missing tools | High |
| Docker Processes | 3→4 processes | Medium |
| Dead Skills | Removed mandatory skills | High |
| Missing Commands | Undocumented commands | Medium |
| File Paths | Fallback path fixes | Low |
| Env Vars | Missing environment variables | High |

## ✅ Success Criteria

- Line count growth tracked (228→330 lines)
- All exploration findings applied
- Verification read completed
- No regression in documentation quality
