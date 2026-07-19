---
title: Conventions
description: Naming, file organization, error handling, git practices, and database isolation conventions for the Ingenium system.
---

# Conventions

## OpenCode Web/CLI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` with a **Web/CLI dual-mode interface**. The conversational chat interface has been separated to its own page at `/chat`.

- **Web mode** — Embeds the OpenCode Web UI in a full-viewport iframe. The iframe `src` is dynamically resolved: loopback HTTP → `http://localhost:4098/`, LAN HTTP / HTTPS → `/opencode-web/` (same-origin proxy path). Overridable via `NEXT_PUBLIC_OPENCODE_WEB_URL` (relative same-origin paths only).
- **CLI mode** — Embeds a ttyd terminal in a full-viewport iframe. URL resolution follows the same pattern: loopback HTTP → `http://localhost:4099/`, LAN HTTP / HTTPS → `/opencode-cli/` (overridable via `NEXT_PUBLIC_OPENCODE_CLI_URL`, relative same-origin paths only). Runs `opencode attach http://localhost:4098 --dir /workspace`, sharing session state.
- **Mode switch** — On the main `/opencode` page, a **segmented Web/CLI toggle** is integrated into the `OpenCodeToolbar` (a compact top toolbar with fullscreen, pop-out, and a green/red status indicator). The old floating right-edge `OpenCodeSwitch` component is deprecated in the main page but persists for the standalone pop-out (`/standalone?page=opencode`), which uses its own simplified right-edge floating toggle. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` (not `display:none`) to prevent xterm dimension zeroing — both iframes remain in the DOM at full size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage`.
- **Session sharing**: All sessions (Web iframe, CLI ttyd, direct terminal attachments) share the same backend process state.
- **Workspace** (`~/repos`) is mounted to `/workspace` in the container via Docker volume.

## DB Isolation
- Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries
- CI enforces: `grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/` must return empty

## API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.

## Dashboard Styling Guide

Every service with a frontend (Next.js dashboard) must have a `STYLING-GUIDE.md` in its service directory. This documents:
- Color palette with exact values
- Typography scale
- Layout grid and spacing
- Component-level styles (nav, cards, forms)
- Rules that must not be broken

The guide is generated from a live screenshot using the vision API and updated whenever visual changes are made.

## Self-Learning Pipeline — Observations (Preferred)

Observations are primarily created by the server-side extraction engine (Phase 0), which reads OpenCode messages and uses the synthesis LLM to extract behavior rules. Manual `ingenium_observe()` calls are for exceptional cases only.

The self-learning pipeline uses **observations** instead of the deprecated `ingenium_learning_log` tool.

Observations are **DB-primary** with a **file fallback**: if the API is down, observations append to `.opencode/skills/observations.md`. On the next session start, `importObservationsFromFile()` in the observer plugin syncs file entries into the DB. The MCP tool is the primary source of truth; the file is a resilience layer.

**Observation types** (Zod schema, `packages/ingenium-core/lib/schema.ts`):

| Type | When used |
|------|-----------|
| `correction` | User corrects agent behavior |
| `preference` | User preference or configuration choice (most common) |
| `pattern` | Repeated convention, workflow, or discovered pattern |
| `insight` | Novel discovery |
| `feedback` | Implicit accept/reject |
| `behavior` | User behavior signal |
| `terminology` | Preferred language |
| `workflow` | Workflow sequence |
| `error` | User encountered error |
| `goal` | Stated or implied goal |

The `engineering-workflow` canonical skill (which absorbed the former orchestrator-primer training) requires the orchestrator to call `ingenium_observe(observation_type="preference", ...)` after every subagent task that modifies files (🔴 HARD RULE). The `development-conventions` skill extends this to all agents for any code change. The `skill-maintenance` skill adds auto-trigger instructions for logging when detection signals fire.

> 🔴 **Note:** The old `ingenium_learning_log` tool is deprecated but still functional for backward compatibility. New code should use `ingenium_observe`.

### Related Self-Learning Skill

See `.opencode/skills/self-learning/SKILL.md` for complete documentation of the self-learning pipeline, including:
- Observation types and when to use them
- Personality trait generation rules
- Synthesis pipeline architecture
- MCP tools reference

## Docker Configuration
- Build-time UID matching host user for write access to workspace
- Appuser home dirs pre-created for OpenCode config persistence (`opencode-config`, `opencode-data` volumes)
- Supervisorctl section for restart management

## Plugin Auto-Config Sync

Every plugin lifecycle operation (create, enable, disable, delete, seed, update) MUST also sync `.opencode/plugins/<file>.ts` on disk AND update `opencode.json`'s `plugin` array.

- `addPluginToConfig()` appends `.opencode/plugins/<file>` to `opencode.json`'s `plugin` array.
- `removePluginFromConfig()` removes it.
- All path resolution uses `getProjectRoot()` which resolves from `INGENIUM_CORE_DB_PATH` (`../../`) — never `process.cwd()`.
- This prevents the "disconnected config" bug where the DB shows a plugin as enabled but OpenCode can't load it because the file or config entry is missing.

## Skill file_tree Convention

Every skill in the DB has a `file_tree` column (TEXT, JSON map of relative paths → file content). This ensures complete data round-trips between DB and disk:
- **Writing to disk**: `writeSkillToDisk()` always writes SKILL.md (with YAML frontmatter) + metadata.json, then writes every file in the `file_tree` JSON to the skill directory.
- **Reading from disk**: `syncSkillFromDisk()` reads SKILL.md + metadata.json, walks the directory tree for all auxiliary files (excluding SKILL.md and metadata.json), and stores them as `file_tree` JSON.
- **Split-skill format on disk**: Each skill is a directory with `SKILL.md` (main content + YAML frontmatter), `metadata.json` (tags, alwaysApply), and optional `references/` directory for auxiliary docs.
- **Skills live at `.opencode/skills/`** — edit SKILL.md here, then use the dashboard or `ingenium_skill_sync` to persist changes to the DB.
- **Runtime copy at `.opencode/skills/`** is automatically written from the DB. Do not edit — changes will be overwritten unless synced back.

## SSR Portal Guard — `createPortal` + `mounted` Pattern

Components that use `createPortal(..., document.body)` **must defer rendering until client hydration completes** to prevent `document is not defined` SSR errors. The pattern:

```tsx
"use client";
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";

export default function PortalComponent() {
  // SSR guard: createPortal(..., document.body) cannot run during SSR
  // because document is undefined on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return createPortal(/* ... */, document.body);
}
```

**Components using this pattern:**
- `SettingsOverlay.tsx` — full-screen settings overlay
- `ServiceOverlay.tsx` — status detail overlay (both service and application types)

The `Overlay.tsx` shared component does NOT include this guard — it relies on callers passing `isOpen={false}` during SSR. For directly rendered portals (always in the DOM tree), the `mounted` guard is mandatory.

## SSR Iframe Guard — Deferred `src` Resolution

Iframes with a dynamically-resolved `src` that depends on `window.location` **must defer URL resolution to after client hydration** to prevent the iframe from navigating to the SSR-generated fallback URL before React hydration replaces it. The pattern:

```tsx
"use client";
import { useState, useEffect } from "react";

export default function DynamicIframe() {
  const [src, setSrc] = useState<string | null>(null);

  // Resolve after hydration so the iframe never first navigates to
  // the SSR fallback proxy URL.
  useEffect(() => {
    setSrc(getRuntimeUrl());
  }, []);

  return <iframe src={src ?? undefined} /* ... */ />;
}
```

**When to use this pattern:**
- Iframe `src` is computed from `window.location.protocol`, `hostname`, or `port`
- The computation falls back to a same-origin proxy path during SSR (when `window` is undefined)
- Navigating the iframe to the proxy path before hydration would cause a spurious redirect or mixed-content request

**Components using this pattern:**
- `OpenCodeFrame.tsx` — OpenCode Web/CLI iframe URLs resolved post-hydration

## 🔴 Skill Data Integrity & Security Rules

These are non-negotiable rules enforced across core (`packages/ingenium-core/lib/tools/skills.ts`) and extension (`packages/ingenium-extension/resource-sync.ts`). Full detail at [skills.md](../reference/skills.md).

| Rule | Enforcement | Scope |
|------|-------------|-------|
| **Safe skill names** | `isSafeSkillName()` — 1-64 chars, no `/`, `\`, NUL, `.`, `..` | All mutation paths |
| **file_tree must be JSON object with string values** | `isValidSkillFileTree()` rejects arrays, non-string values, non-objects | create, update, proposals |
| **No path traversal in file_tree** | `resolveSafePath()` — containment check: resolved path must start with baseDir | writeSkillToDisk |
| **No absolute paths** | `isAbsolute()` rejection | resolveSafePath |
| **Reserved canonical files blocked** | SKILL.md and metadata.json paths cannot appear in file_tree | resolveSafePath |
| **Directory targets rejected** | Existing directory paths in file_tree are refused (must be files) | resolveSafePath |
| **Symlink escape prevention** | Walk upward from target to nearest ancestor; realpath must stay within baseDir. Post-write re-verification removes escaped files. | resolveSafePath + writeSkillToDisk |
| **Dangling symlink ancestors** | lstatSync on each ancestor component; symlinks at any level rejected | resolveSafePath |
| **Archive-only deletion** | `deleteSkill()` delegates to `archiveSkill()`. Hard-delete is impossible — skills are never permanently removed from the DB. | API routes, MCP tools |
| **Archive preserves auxiliary files** | Only SKILL.md is removed on archive; metadata.json + all file_tree content survive for restoration | archiveSkill, disableSkill |
| **Resource-sync never follows symlinks** | `rmRecursive()` uses lstat per entry; symlinks are unlinked, targets untouched. Root-level symlink rejection before removal. | resource-sync.ts |
| **Resource-sync preserves category and auxiliary files** | metadata.json `category` field is sent to API; only SKILL.md and metadata.json are excluded from file_tree collection | resource-sync.ts pushSkillToApi |
| **Resource-sync supports CRLF** | Frontmatter parser regex `/^---\r?\n/` matches both line ending styles | parseYamlFrontmatter |

## Email Security — Credentials (OAuth tokens and app passwords) are encrypted with AES-256-GCM before storage in SQLite settings. No plaintext credentials in the DB or logs. Encryption key from INGENIUM_EMAIL_ENCRYPTION_KEY env var.
