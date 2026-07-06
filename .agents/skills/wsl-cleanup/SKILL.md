---
name: wsl-cleanup
description: "WSL2 Ubuntu system maintenance and disk cleanup — Docker prune, apt/pip/npm caches, journalctl vacuum, temp file cleanup, snap revisions, model caches. 🔴 Never touches $HOME/repos. Use when disk space is low or routine maintenance is needed."
---

# WSL2 Ubuntu Cleanup & Disk Maintenance

## When to Use

Invoke this skill when the user makes a request related to WSL2 disk space or system maintenance. Trigger phrases include:

- "clean up WSL"
- "disk space low"
- "free up space"
- "docker prune"
- "system maintenance"
- "WSL is running out of space"
- "clean temp files"
- "clear cache"
- "WSL disk is full"
- "clean up WSL disk"
- "WSL is slow, likely disk-related"
- "reclaim space on WSL"
- "run a cleanup"

## 🔴 HARD RULEs

These rules override everything else. They are not optional.

### 🔴 NEVER Touch `$HOME/repos`

**The `$HOME/repos` directory and all subdirectories are off-limits.** No cleanup, no listing, no analysis, no operations of any kind inside `$HOME/repos`. This is the only exclusion — everything else in `$HOME` may be fair game with proper confirmation.

Before running ANY command that operates on paths, verify the path does not start with `$HOME/repos` or a resolved equivalent.

### 🔴 Assess Before Acting

**Show disk usage before any destructive operation.** Always run `df -h` as the first step so both you and the user know what space is available and where the pressure is.

### 🔴 Confirm Before Destruction

**Always confirm with the user before running any destructive command.** A destructive command is any command that removes, prunes, purges, or deletes data — including `docker system prune`, `apt autoremove --purge`, `rm -rf`, `journalctl --vacuum-*`, `snap remove`, and `ollama rm`. Show the expected impact (estimated space, what will be removed) and wait for explicit approval.

### 🔴 Shell Safety Patterns

**Every multi-command shell statement must follow `set -euo pipefail` safety patterns.** Reference `.agents/skills/shell-scripts/SKILL.md` for details:

- Use `|| true` tolerance for commands that may fail (Docker not installed, no journals, etc.)
- Quote all variable expansions: `"$HOME"` not `$HOME`
- Use `[[ ]]` for conditionals
- Use `trap` for cleanup if running a multi-step script
- Never background processes with `&`

### 🔴 No Force Flags Without Confirmation

**Never use `--force` or equivalent flags without explicit user confirmation.** This includes `docker system prune --force`, `apt-get --force-yes`, `npm cache clean --force`, and similar. Show the user the exact command with `--force` and explain why it's needed before asking permission.

## 1. Pre-Flight Assessment (Always First)

Before any cleanup operation, run these commands to assess current state:

```bash
# Disk usage by mount point
df -h

# Docker disk usage (tolerate missing Docker)
docker system df || true

# Top 20 largest directories in $HOME
du -sh "$HOME"/* 2>/dev/null | sort -hr | head -20 || true

# Journal disk usage
journalctl --disk-usage || true
```

**Review the output and identify where the space pressure is before proposing specific cleanups.** Present the findings to the user and suggest a plan.

## 2. Docker Cleanup

> References: `.agents/skills/containers/SKILL.md` for Docker conventions and best practices.

All commands assume Docker is installed. Use `|| true` to tolerate missing Docker.

| Command | Description | Risk | Est. Space |
|---------|-------------|------|------------|
| `docker system df` | **Assessment only** — show Docker disk usage breakdown by type (images, containers, volumes, build cache). No data removed. | 🟢 Safe | 0 MB |
| `docker container prune` | Remove all stopped containers. Does not touch images, volumes, or networks. | 🟢 Safe | Varies |
| `docker image prune -a` | Remove all unused images (not referenced by any container, including dangling). More aggressive than `docker image prune` (dangling only). | 🟡 Moderate | Varies |
| `docker system prune --volumes` | Remove all unused containers, networks, images (dangling only), **and volumes**. Volumes may contain persistent data — confirm with user. | 🟡 Moderate | 1-20 GB |
| `docker builder prune` | Remove build cache. Safe to run regularly. Does not affect images or containers. | 🟢 Safe | 0.5-10 GB |
| `docker volume prune` | Remove all unused (unmounted) volumes. Review first — some volumes may be intentionally unmounted but valuable. | 🟡 Moderate | 1-10 GB |
| `docker system prune -a --volumes` | **Aggressive** — remove ALL unused: containers, networks, images (all unused, not just dangling), build cache, and volumes. Destructive if volumes are important. | 🔴 Destructive | 5-50 GB |

**Recommended safe workflow:**

```bash
# Step 1: Containers (always safe)
docker container prune

# Step 2: Unused images (confirm first)
docker image prune -a

# Step 3: Build cache (safe, no container impact)
docker builder prune

# Step 4: Show freed space
docker system df
```

**Before aggressive pruning** (`-a --volumes`), always show the user what would be removed:

```bash
docker system df --verbose | head -50
```

## 3. Package Manager Caches

| Command | What It Cleans | Risk | Est. Space |
|---------|---------------|------|------------|
| `sudo apt-get clean` | Remove all downloaded `.deb` package archives from `/var/cache/apt/archives/`. Safe — packages are re-downloaded if needed. | 🟢 Safe | 200-800 MB |
| `sudo apt-get autoclean` | Remove only **obsolete** `.deb` archives (packages no longer available in repositories). More conservative than `clean`. | 🟢 Safe | 0-200 MB |
| `sudo apt-get autoremove --purge` | Remove orphaned dependency packages that were automatically installed and are no longer needed. **Review the list first** — it shows what will be removed. The `--purge` flag also removes config files. | 🟡 Moderate — review recommended | 100-500 MB |
| `pip cache purge` | Remove pip's HTTP cache and wheel cache from `~/.cache/pip/`. No impact on installed packages. | 🟢 Safe | 0.5-5 GB |
| `npm cache clean --force` | Remove npm's global cache from `~/.cache/npm/`. Requires `--force` — confirm with user. No impact on installed `node_modules`. | 🟡 Moderate — `--force` requires confirmation | 0.5-3 GB |
| `yarn cache clean` | Remove yarn's global cache. Safe — no impact on installed packages or `node_modules`. | 🟢 Safe | 0.2-2 GB |

**Recommended workflow:**

```bash
# APT cache (safe)
sudo apt-get clean

# APT autoclean (safe, more conservative)
sudo apt-get autoclean

# Orphaned deps — REVIEW output before confirming
sudo apt-get autoremove --purge

# Pip cache
pip cache purge 2>/dev/null || true

# npm cache — requires explicit confirmation for --force
npm cache clean --force 2>/dev/null || true

# yarn cache
yarn cache clean 2>/dev/null || true
```

## 4. Systemd Journal Cleanup

Systemd journals accumulate logs over time. By default, journals are persistent in `/var/log/journal/` and can be safely rotated or vacuumed.

| Command | Description | Risk | Est. Space |
|---------|-------------|------|------------|
| `journalctl --disk-usage` | **Assessment only** — show current journal size. No data removed. | 🟢 Safe | 0 MB |
| `journalctl --vacuum-size=200M` | Reduce journal to a maximum of 200 MB. Oldest entries removed first. | 🟢 Safe | 100-900 MB |
| `journalctl --vacuum-time=7d` | Keep only the last 7 days of logs. Older entries removed. | 🟢 Safe | 100-900 MB |
| `sudo journalctl --rotate` | Rotate journals (close active journal, start new one). Non-destructive — use before vacuum if journals are still active. | 🟢 Safe | 0 MB |

**Safe workflow:**

```bash
# Assess first
journalctl --disk-usage

# Rotate (ensure all journals are flushed)
sudo journalctl --rotate

# Option A: Limit by size
sudo journalctl --vacuum-size=200M

# Option B: Limit by time
sudo journalctl --vacuum-time=7d

# Verify reduction
journalctl --disk-usage
```

**Note:** The `sudo journalctl --rotate` + vacuum sequence is idempotent and non-destructive. No running system is affected.

## 5. Temp File Cleanup

> ⚠️ **Warning:** `/tmp/` may contain X11 sockets (`/tmp/.X11-unix/`), Unix sockets, and active files used by running processes. **Do NOT blindly delete everything in `/tmp/`** — only target files with old access times. Sockets and pipes cannot be matched by `-type f` and will be preserved.

```bash
# Assess temp space first
du -sh /tmp /var/tmp 2>/dev/null || true

# Safe: Old files in /var/tmp (accessed 7+ days ago)
sudo find /var/tmp -type f -atime +7 -delete 2>/dev/null || true

# Safe: Empty your trash
rm -rf "$HOME/.local/share/Trash/"* 2>/dev/null || true

# More aggressive (requires confirmation): Old files in /tmp
# Only matches regular files (-type f), not sockets or pipes
# Only files accessed 3+ days ago
sudo find /tmp -type f -atime +3 -delete 2>/dev/null || true
```

**Risk assessment:**

| Action | Risk | Notes |
|--------|------|-------|
| `find /var/tmp -type f -atime +7 -delete` | 🟢 Safe | Old files only; rarely impacts running processes |
| `rm -rf ~/.local/share/Trash/*` | 🟢 Safe | Trash is already marked for deletion |
| `find /tmp -type f -atime +3 -delete` | 🟡 Moderate | Review `/tmp` contents first; may impact long-running processes |
| `rm -rf /tmp/*` | 🔴 Destructive | **Never do this** — will kill X11, sockets, and running processes |

## 6. Snap Cleanup

Snap packages retain old revisions when updated. These disabled revisions can be safely removed.

```bash
# List all snap revisions including disabled ones
snap list --all
```

**Remove all disabled revisions:**

```bash
# Safe: removes only disabled snap revisions
for rev in $(snap list --all | awk '/disabled/{print $3}'); do
    snap_name=$(snap list --all | awk -v r="$rev" '$3==r{print $1}')
    sudo snap remove --revision="$rev" "$snap_name"
done
```

| Action | Risk | Est. Space | Notes |
|--------|------|------------|-------|
| `snap list --all` (assessment) | 🟢 Safe | 0 MB | Shows current + disabled revisions |
| Remove disabled revisions | 🟡 Moderate | 0.5-5 GB | Some snaps may re-enable old revisions on next refresh — safe to remove again |

**Note:** If `snap` is not installed (common on WSL2 Ubuntu without `snapd`), the commands will fail silently — use `|| true` tolerance.

## 7. Model Cache Cleanup (if AI/ML tools are installed)

These are typically the largest space consumers on a developer's WSL2 instance.

| Tool | Location | Assessment | Cleanup |
|------|----------|------------|---------|
| **Ollama** | `~/.ollama/models/` | `ollama list` | `ollama rm <model>` for each unused model |
| **LM Studio** | `~/.lmstudio/models/` | `du -sh "$HOME/.lmstudio/models/"*` | `rm -rf <model-dir>` with confirmation |
| **HuggingFace** | `~/.cache/huggingface/hub/` | `du -sh "$HOME/.cache/huggingface/hub/"*` | `rm -rf <model-dir>` with confirmation |

```bash
# Ollama — list and remove
ollama list 2>/dev/null || true
# Remove specific model: ollama rm <model-name>

# LM Studio models
du -sh "$HOME/.lmstudio/models/"* 2>/dev/null | sort -hr || true
# Remove specific model dir: rm -rf "$HOME/.lmstudio/models/<model>" (with confirmation)

# HuggingFace cache
du -sh "$HOME/.cache/huggingface/hub/"* 2>/dev/null | sort -hr || true
# Remove specific model: rm -rf "$HOME/.cache/huggingface/hub/<model-dir>" (with confirmation)
```

| Location | Risk | Est. Space | Notes |
|----------|------|------------|-------|
| Ollama models | 🟡 Moderate | 2-20 GB per model | Model must be re-pulled if needed again |
| LM Studio models | 🟡 Moderate | 2-50 GB | Manual directory removal |
| HuggingFace hub | 🟡 Moderate | 1-100 GB | Model will be re-downloaded on next `from_pretrained()` |

## 8. Comprehensive Cleanup Workflow

A safe, step-by-step full-system cleanup that the AI can walk the user through.

### Step 1: Pre-Flight Assessment

```bash
echo "=== DISK USAGE ==="
df -h
echo ""
echo "=== DOCKER DISK USAGE ==="
docker system df 2>/dev/null || echo "Docker not installed"
echo ""
echo "=== JOURNAL DISK USAGE ==="
journalctl --disk-usage 2>/dev/null || echo "Journalctl not available"
echo ""
echo "=== TOP 20 LARGEST HOME DIRECTORIES ==="
du -sh "$HOME"/* 2>/dev/null | sort -hr | head -20
```

### Step 2: Present Findings

Show the user the output from Step 1 and say something like:

> _"Your WSL2 instance has **X GB free** on `/`. Docker is using **Y GB**, journals are **Z MB**, and there are large directories at [list]. I recommend running [docker cleanup | apt cleanup | journal vacuum | model cache cleanup]. Would you like to proceed? (y/N)"_

### Step 3: Run Cleanup in Order (with confirmation)

Wait for user confirmation, then run steps sequentially, showing results after each:

```bash
echo "=== 1. DOCKER CLEANUP ==="
docker container prune -f 2>/dev/null || true
docker image prune -a -f 2>/dev/null || true
docker builder prune -f 2>/dev/null || true
echo ""

echo "=== 2. PACKAGE MANAGER CACHES ==="
sudo apt-get clean 2>/dev/null || true
sudo apt-get autoclean 2>/dev/null || true
sudo apt-get autoremove --purge -y 2>/dev/null || true
pip cache purge 2>/dev/null || true
yarn cache clean 2>/dev/null || true
echo ""

echo "=== 3. SYSTEMD JOURNAL ==="
sudo journalctl --rotate 2>/dev/null || true
sudo journalctl --vacuum-size=200M 2>/dev/null || true
echo ""

echo "=== 4. TEMP FILES ==="
sudo find /var/tmp -type f -atime +7 -delete 2>/dev/null || true
rm -rf "$HOME/.local/share/Trash/"* 2>/dev/null || true
echo ""

echo "=== 5. SNAP CLEANUP ==="
if command -v snap &>/dev/null; then
    for rev in $(snap list --all 2>/dev/null | awk '/disabled/{print $3}'); do
        snap_name=$(snap list --all | awk -v r="$rev" '$3==r{print $1}')
        sudo snap remove --revision="$rev" "$snap_name" 2>/dev/null || true
    done
fi
```

> **Note:** The `-f` flags on Docker commands in the workflow are auto-confirm flags (`--force` equivalent). Per the HARD RULE, these require user confirmation. Present the exact command with `-f` and explain: _"The `-f` flag skips the interactive confirmation prompt for each pruned item. It is safe to use when you've already confirmed the operation."_ Do NOT use `-f` without first confirming with the user.

### Step 4: Post-Flight Report

```bash
echo "=== CLEANUP COMPLETE ==="
echo ""
echo "=== DISK USAGE AFTER ==="
df -h
echo ""
echo "=== DOCKER USAGE AFTER ==="
docker system df 2>/dev/null || true
echo ""
echo "=== JOURNAL USAGE AFTER ==="
journalctl --disk-usage 2>/dev/null || true
```

Compare before/after and report:

> _"Cleanup complete. Reclaimed approximately **X GB** total. You now have **Y GB free** on `/`."_

## 9. Component Disk Usage Reference

Typical locations and expected sizes on a WSL2 Ubuntu system. Use these to help users understand where the most space is likely being consumed.

| Location | Typical Size | Notes |
|----------|-------------|-------|
| `/var/lib/docker/` | 5-50 GB | Main Docker storage — images, containers, volumes, build cache |
| `~/.cache/pip/` | 0.5-5 GB | Pip package cache (wheels, HTTP cache) |
| `~/.cache/npm/` | 0.5-3 GB | npm global cache |
| `~/.cache/yarn/` | 0.2-2 GB | Yarn global cache |
| `~/.cache/huggingface/` | 1-100 GB | HuggingFace model cache (`hub/` directory) |
| `~/.ollama/models/` | 2-40 GB | Ollama model storage — each model is 2-20 GB |
| `~/.lmstudio/models/` | 5-50 GB | LM Studio model files |
| `/var/log/journal/` | 100-500 MB | Systemd journal (configurable via `--vacuum-size`) |
| `/var/cache/apt/archives/` | 200-800 MB | Downloaded `.deb` package archives |
| `/tmp/` | 0-1 GB | Temp files (self-cleaning on reboot typically) |
| `~/.local/share/Trash/` | 0-5 GB | Desktop trash/bin |
| `/var/lib/snapd/` | 1-5 GB | Snap packages and revisions |
| `~/.cache/` (other) | 0.5-2 GB | Various application caches |
| `/var/tmp/` | 0-500 MB | Preserved temp files (not cleaned on reboot) |

## 10. References

- **`.agents/skills/shell-scripts/SKILL.md`** — Shell safety patterns (`set -euo pipefail`, quoting, `trap cleanup EXIT`, `|| true` tolerance). Reference before writing any multi-command shell sequences.
- **`.agents/skills/containers/SKILL.md`** — Docker conventions, multi-stage builds, layer ordering. Use when reviewing or modifying Docker-related cleanup commands.
- **`.agents/skills/debugging-patterns/SKILL.md`** — Systematic debugging methodology. Use when cleanup is part of a diagnostic workflow (e.g., "WSL is running out of space and app X is crashing").
- **`.agents/skills/generic-conventions/SKILL.md`** — Universal coding rules: comments, DRY, error handling, secure coding. Apply to any scripts or automation written as part of cleanup.
- **`man journalctl`** — Full documentation for journal control options (`--vacuum-size`, `--vacuum-time`, `--rotate`).
- **`man docker-system-prune`** — Full documentation for Docker prune options.

---

> **Tip:** For WSL2 specifically, consider running `wsl --shutdown` from PowerShell on the host side occasionally. WSL2 VHDX files only shrink when the WSL instance is terminated, not while running. The ext4.vhdx file at `%LOCALAPPDATA%\Packages\*Ubuntu*\LocalState\` can be compacted with `diskpart` after shutdown for additional host-side space recovery — but that is outside the scope of this skill (host-side operation).
