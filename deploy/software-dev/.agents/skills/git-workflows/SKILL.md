---
name: git-workflows
description: "Git workflow patterns beyond the basics — rebase vs merge, bisect, reflog recovery, conventional commits, clean history. Complements gh-cli (GitHub API) with git DAG operations. Use when rewriting history, recovering lost commits, or structuring branches."
---

# Git Workflows

## When to Use

- Cleaning up a feature branch before merging (squash, rebase)
- Finding which commit introduced a bug (`git bisect`)
- Recovering a commit that was "lost" by a reset or rebase (`git reflog`)
- Reviewing the commit history of a file or feature
- Standardizing commit message format for auto-changelog generation
- Understanding whether to merge or rebase in a given situation

## 🔴 HARD RULE — Never Force Push to Shared Branches

`git push --force` rewrites history that others may have based work on. Only force-push to branches that are exclusively yours (personal feature branches, not `main`, `develop`, or team branches).

```bash
# ❌ BAD — force push to a shared branch
git checkout main
git rebase feature-x
git push --force   # destroys history your team depends on

# ✅ GOOD — force push only to your feature branch
git checkout feature/x-fix-bug
git rebase main
git push --force-with-lease   # --force-with-lease is safer: it checks if anyone else pushed
```

Use `--force-with-lease` instead of `--force`. It aborts the push if the remote branch has commits you don't have locally, preventing accidental overwrites of teammates' work.

## Rebase Workflow — Linear History for Feature Branches

**When**: You want a clean, linear history on top of the latest main before merging.

```bash
# Update feature branch with latest main
git checkout feature/my-feature
git fetch origin
git rebase origin/main

# If conflicts arise:
# 1. Resolve conflicts in each file
# 2. git add <resolved-file>
# 3. git rebase --continue
# 4. Repeat until rebase completes

# If rebase goes wrong:
git rebase --abort   # return to pre-rebase state
```

| Situation | Command |
|-----------|---------|
| Rebase onto main | `git rebase origin/main` |
| Skip a conflicting commit | `git rebase --skip` |
| Pause and fix conflict | `git rebase --continue` after `git add` |
| Give up on rebase | `git rebase --abort` |
| Interactive rebase (edit/squash) | `git rebase -i HEAD~N` |

### Interactive Rebase — Squash, Edit, Reword

```
# ❌ BEFORE — messy local history
git log --oneline
abc1234 WIP
def5678 fix typo
ghi9012 actually fix it this time
jkl3456 Add feature X

# ✅ AFTER — clean history
git rebase -i jkl3456^
# In editor, change pick → squash for fixup commits
# Result: one clean commit "feat: Add feature X with tests"
```

## Bisect Workflow — Find the Culprit Commit

**When**: A regression exists between two known states (good → bad).

```bash
# Start
git bisect start
git bisect bad HEAD         # current commit has the bug
git bisect good v1.0        # this tag/commit was clean

# git checks out the midpoint.
# Test the current state:
go test ./...               # or: npm test, python -m pytest, etc.

# Mark the result:
git bisect good              # if test passes here
git bisect bad               # if test fails here

# Repeat until git identifies the first bad commit
# Done — git shows the exact commit that introduced the bug

# Clean up
git bisect reset
```

### Automating Bisect

```bash
# Write a script that exits 0 (good) or non-zero (bad)
# then let git run it automatically:
git bisect start HEAD v1.0
git bisect run go test ./...
git bisect reset
```

**Gotcha**: The test script must be idempotent — running it twice at the same commit must give the same result. Flaky tests break bisect.

## Reflog Recovery — "I Lost My Changes"

**When**: You ran `git reset --hard`, `git rebase --abort` accidentally, or a branch disappeared.

```bash
# View the reflog — every HEAD movement is recorded
git reflog

# Output (example):
# abc1234 HEAD@{0}: checkout: moving from feature to main
# def5678 HEAD@{1}: commit: Add logging
# ghi9012 HEAD@{2}: reset: moving to HEAD~3
# jkl3456 HEAD@{3}: commit: WIP debugging

# To recover:
# Option 1: Checkout the commit directly
git checkout def5678

# Option 2: Create a branch at the recovered commit
git branch rescued-work def5678

# Option 3: Cherry-pick onto current branch
git cherry-pick def5678
```

**Gotcha**: Reflog entries expire after 90 days (configurable with `gc.reflogExpire`). Act quickly after a loss. `git reflog` only tracks local operations — clones and fresh checkouts don't have reflog history.

## Squash Before Merge — Clean Integration

**When**: A feature branch has many messy commits (WIP, fixups, typos) that don't need to be in the permanent history.

```bash
# Method 1: Interactive rebase
git rebase -i HEAD~N     # N = number of commits to squash
# Change pick → squash for all but the first commit

# Method 2: Soft reset + single commit (simpler)
git checkout feature/my-feature
git reset --soft main
git commit -m "feat: Add my feature with full implementation"

# Method 3: Merge with squash (GitHub/GitLab UI)
# git merge --squash feature/my-feature
# git commit -m "feat: ..."
```

## Conventional Commits — Auto-Changelog Compatible

**When**: You want changelogs generated automatically and semantic version bumps computed from commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Releases when | Changelog section |
|------|---------------|-------------------|
| `feat` | Minor | New Features |
| `fix` | Patch | Bug Fixes |
| `docs` | — | Documentation |
| `style` | — | Styles (formatting, not CSS) |
| `refactor` | — | Code Refactoring |
| `perf` | Patch | Performance Improvements |
| `test` | — | Tests |
| `chore` | — | Chores |
| `BREAKING CHANGE` / `!` | Major | Breaking Changes |

### Examples

```
feat(auth): add OAuth2 token refresh flow

fix(api): handle empty response body correctly

docs: update API usage examples

refactor(core): extract payment validation logic

feat!: change database schema to v2 (BREAKING CHANGE)
```

## Model Notes

- **7B-9B models**: Frequently confuse `rebase` flags — `--onto` vs `-i`, `--continue` vs `--skip`, `--force-with-lease` vs `--force`. Use the tabular format above (Situation → Command table under Rebase Workflow) to look up the exact command rather than constructing it from memory.
- **14B-27B models**: Better at constructing multi-step workflows but still produce subtle errors in Interactive Rebase instructions (wrong commit count, incorrect `pick`/`squash` mapping). Always count commits explicitly and verify the rebase plan visually.
- **All local models**: `git reflog` recovery is the workflow where smaller models add the most value — it's a mechanical lookup operation (find the hash, recover it). Lean into this strength. Conversely, `git rebase` conflict resolution is where small models struggle most — the context of both sides of the conflict exceeds their reasoning window. Recommend `git rebase --abort` and manual resolution when conflicts are complex.
- **Time-saving rule**: When asked "can I undo this git operation?", always check if it's a `reflog` recoverable operation first. Most destroyed work (90%+) is recoverable with `reflog`. Don't panic the user — tell them "yes, here's how."
