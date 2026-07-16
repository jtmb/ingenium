---
name: git-history-hygiene
description: "Prevent build artifacts and large files from polluting Git history via strict ignore rules and cleanup protocols."
alwaysApply: true
tags: ["llm-synthesized", "auto-generated"]
---

# git-history-hygiene

## 🔴 HARD RULEs
1. **NEVER commit build artifacts** (`.next`, `.sst`, `node_modules`, `.ingenium`) to main branch.
2. **Ensure `.gitignore` is committed BEFORE first commit** of any project.
3. **Purge history immediately** if large files are tracked using `git filter-repo`.

## Usage Examples

### Correct Workflow
```bash
# 1. Add .gitignore before initial commit
echo ".next/" >> .gitignore
echo ".sst/" >> .gitignore
git add .gitignore
git commit -m "Add gitignore rules"

# 2. Verify before push
git status --short
git lfs ls-files # Check for large files
```

### Remediation (If Tracked)
```bash
# If history is polluted with .next or .sst
git filter-repo --invert-paths --path '.next/' --path '.sst/' --force
# Then force push the cleaned branch
git push origin <branch> --force
```

## Pattern Enforcement
- **Pre-commit Check:** Verify `.gitignore` exists and contains build paths.
- **Post-commit Audit:** Run `git count-objects -vH` to detect bloat before pushing.
- **Tooling:** Use `git filter-repo` for historical cleanup, not manual commit removal.
