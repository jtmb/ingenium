---
title: "WSL Comprehensive Cleanup Workflow and Post-Flight Report"
impact: MEDIUM
impactDescription: "Provides a safe, step-by-step full-system cleanup the AI can walk users through"
tags: [wsl, workflow, cleanup, report]
---

## WSL Comprehensive Cleanup Workflow

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

Show the user the output and summarize where space pressure is. Recommend specific cleanups and wait for confirmation.

### Step 3: Run Cleanup in Order (with confirmation)

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

Compare before/after and report reclaimed space.

### Tip

For WSL2 specifically, consider running `wsl --shutdown` from PowerShell on the host side occasionally. WSL2 VHDX files only shrink when the WSL instance is terminated. The ext4.vhdx file can be compacted with `diskpart` after shutdown for additional host-side space recovery.
