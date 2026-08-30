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

## 🔴 Orchestration Visual Validation
- Visual validation is required during orchestration testing. Follow the canonical `@engineering-workflow` visual-validation protocol for changed UI routes and the final all-primary-routes desktop/mobile sweep.
