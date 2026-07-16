---
name: visual-standards-conventions
description: "Visual design and UI standardization rules for overlays, cards, and page layouts"
---

# Visual Standards Conventions

## 🔴 HARD RULEs
- All new overlays must use constrained default sizing: w-11/12 max-w-7xl max-h-[90vh]
- No new overlays should use fullScreen mode
- Status page cards must distinguish between supervisord services (/services/:name) and in-process applications (/services/applications/:name)
- INFO-badge CSS variable must be used for overlay styling

## Reference Files

| File | Content |
|------|--------|
| [`references/overlay-sizing.md`](references/overlay-sizing.md) | Overlay dimension constraints and sizing rules |
| [`references/status-page-cards.md`](references/status-page-cards.md) | Status page card type conventions |
| [`references/css-variables.md`](references/css-variables.md) | INFO-badge and visual standard CSS variables |


## 🔴 HARD RULEs
- Visual validation required during orchestration testing
- Use @vision-bridge for dark-mode screenshot review before accepting work
- Status page cards must distinguish between supervisord services (/services/:name) and in-process applications (/services/applications/:name)

## Reference Files

| File | Content |
|------|--------|
| [`references/orchestrator-visual-validation.md`](references/orchestrator-visual-validation.md) | Visual validation requirements with @vision-bridge for dark-mode screenshots |