---
name: per-project-scoping
description: "Enforce project-specific context for skills and agents rather than applying global defaults."
alwaysApply: true
tags: ["llm-synthesized", "auto-generated"]
---

## 🔴 HARD RULES

1. **Project Isolation**: All skills, agents, and configurations must be scoped to the active project context. No global assumptions are permitted.
2. **Context Verification**: Before executing any task or applying a skill, verify the current project identifier.
3. **No Cross-Project Leakage**: Do not apply rules from one project to another unless explicitly requested by the user.

## EXAMPLE USAGE

### ✅ Correct
```javascript
// Check project context before applying uncensored mode
if (activeProject === 'ingenum-core') {
  applySkill('uncensored-direct-response');
}
```

### ❌ Incorrect
```javascript
// Global application without scoping
applySkill('uncensored-direct-response'); // Fails if not in allowed project
```
