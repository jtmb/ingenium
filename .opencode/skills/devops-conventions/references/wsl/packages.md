---
title: "WSL Package Cache, Journal, Temp File, and Snap Cleanup"
impact: MEDIUM
impactDescription: "Reclaims space from system caches without affecting running services"
tags: [wsl, apt, pip, npm, journal, temp, snap]
---

## WSL Package Cache, Journal, Temp File, and Snap Cleanup

### Package Manager Caches

| Command | What It Cleans | Risk | Est. Space |
|---------|---------------|------|------------|
| `sudo apt-get clean` | Remove all downloaded .deb archives | 🟢 Safe | 200-800 MB |
| `sudo apt-get autoclean` | Remove obsolete .deb archives | 🟢 Safe | 0-200 MB |
| `sudo apt-get autoremove --purge` | Remove orphaned dependency packages | 🟡 Moderate | 100-500 MB |
| `pip cache purge` | Remove pip's HTTP and wheel cache | 🟢 Safe | 0.5-5 GB |
| `npm cache clean --force` | Remove npm's global cache | 🟡 Moderate | 0.5-3 GB |
| `yarn cache clean` | Remove yarn's global cache | 🟢 Safe | 0.2-2 GB |

```bash
sudo apt-get clean
sudo apt-get autoclean
sudo apt-get autoremove --purge   # REVIEW output first
pip cache purge 2>/dev/null || true
npm cache clean --force 2>/dev/null || true   # --force requires confirmation
yarn cache clean 2>/dev/null || true
```

### Systemd Journal Cleanup

```bash
journalctl --disk-usage              # Assessment
sudo journalctl --rotate              # Rotate active journals
sudo journalctl --vacuum-size=200M    # Limit by size
sudo journalctl --vacuum-time=7d      # Limit by time
journalctl --disk-usage               # Verify reduction
```

The rotate + vacuum sequence is idempotent and non-destructive.

### Temp File Cleanup

```bash
# Safe: Old files in /var/tmp (accessed 7+ days ago)
sudo find /var/tmp -type f -atime +7 -delete 2>/dev/null || true

# Safe: Empty your trash
rm -rf "$HOME/.local/share/Trash/"* 2>/dev/null || true

# More aggressive: Old files in /tmp (accessed 3+ days ago)
sudo find /tmp -type f -atime +3 -delete 2>/dev/null || true
```

**Never do `rm -rf /tmp/*`** — will kill X11, sockets, and running processes.

### Snap Cleanup

```bash
# List all snap revisions including disabled ones
snap list --all

# Remove all disabled revisions
for rev in $(snap list --all | awk '/disabled/{print $3}'); do
    snap_name=$(snap list --all | awk -v r="$rev" '$3==r{print $1}')
    sudo snap remove --revision="$rev" "$snap_name"
done
```

If `snap` is not installed (common on WSL2 without snapd), commands fail silently.
