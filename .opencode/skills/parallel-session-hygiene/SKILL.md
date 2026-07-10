---
name: parallel-session-hygiene
description: "Git workflow for handling overlapping commits from parallel sessions — always verify git log before assuming files need deletion."
alwaysApply: true
tags: ["llm-synthesized", "auto-generated"]
---

# 🔴 HARD RULES
1. **ALWAYS check `git log --oneline -5`** before deleting or modifying any file.
2. Parallel sessions can commit overlapping work (e.g., seed/ deletion) that you don't see in your current session view.
3. Never assume a file needs cleanup without verifying its actual state across all active sessions.

## 📋 CORRECT PATTERN (✅)
```bash
# ✅ VERIFY: Check recent commits before acting
git log --oneline -5 | grep seed/
if [ $(git diff HEAD~1..HEAD --stat) ]; then echo "Changes detected"; fi
```

## ❌ INCORRECT PATTERN (⚠️)
```bash
# ⚠️ UNSAFE: Blind deletion without verification
git rm -rf seed/  # Could delete work from parallel session!
```

## 🔧 WHY THIS MATTERS
- **Root Cause**: Multiple sessions can operate simultaneously and commit overlapping changes.
- **User Impact**: Accidental data loss when one session deletes what another is actively using.
- **Fix Pattern**: Always audit git history before cleanup operations to catch cross-session conflicts.
