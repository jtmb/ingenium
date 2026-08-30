---
title: Conventions
description: Naming, file organization, error handling, git practices, and database isolation conventions for the Ingenium system.
---

# Conventions

## OpenCode Web/CLI Embedded in Dashboard
The dashboard includes an embedded OpenCode service at `/opencode` with a **Web/CLI dual-mode interface**. The conversational chat interface has been separated to its own page at `/chat`.

- **Compatibility** — Web/CLI/VS Code use the exact fixed `.localhost:3000` aliases
  and never call the dynamic runtime manager.
- **Production** — Always renders the authorization-filtered workspace picker before
  launching exact runtime audience roots. It never selects a singleton or falls back
  to compatibility aliases. OpenCode is not served under a shared dashboard subpath.
- **Deployment boundary** — The default dashboard and gateway roots are published on port `3000`, which supports Windows-to-WSL localhost forwarding; the bearer API boundary on `4097` remains host-loopback-only and ports `4098`/`4099`/`4100` remain private upstreams. LAN/remote use requires the isolated profile's operator-managed TLS runtime domain.
- **Authentication** — The default Windows↔WSL gateway does not use HTTP Basic Auth or browser bearer tokens. It is a local plain-HTTP profile, not a LAN/remote security profile; remote access requires an operator-managed authenticated TLS profile.
- **Mode switch** — On the main `/opencode` page, a **segmented Web/CLI toggle** is integrated into the `OpenCodeToolbar` (a compact top toolbar with fullscreen, pop-out, and a green/red status indicator). The standalone pop-out (`/standalone?page=opencode`) uses its own simplified right-edge floating toggle. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` (not `display:none`) to prevent xterm dimension zeroing — both iframes remain in the DOM at full size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage`.
- **Session sharing**: Web iframe and CLI ttyd sessions share the same backend process state; direct host attachment to the private upstream ports is not part of the browser-facing contract.
- **Production runtime roots**: Each audience uses exact `<audience>--<runtime-id>.<INGENIUM_RUNTIME_ROOT_DOMAIN>` roots. Special-use `.localhost` roots use browser-trusted HTTP through a loopback-only host binding; remote/custom roots require HTTPS. A browser-generated body-only proof redeems a one-time launch record before iframe/pop-out navigation; the API returns only the launch URL/status, and fixed global health, session tokens, and backend URLs are not exposed.
- **Audience sessions**: Web, CLI, and VS Code use distinct host-only secure cookies. Host, runtime, workspace, owner, auth session, origin, audience, and revocation generation must match.
- **Workspace** (`~/repos`) is mounted to `/workspace` in the container via Docker volume.

## VS Code workspace

- **Origin** — `/vscode` and `/standalone?page=vscode` use the exact local root `http://vscode.localhost:3000/` on the established port-`3000` virtual-host gateway.
- **Production origin** — The isolated profile uses `https://vscode--<runtime-id>.<runtime-domain>/`
  only after explicit start/resume, sharing the runtime container but not Web/CLI
  audience cookies. The fixed VS Code alias returns static `404` guidance.
- **Boundary** — code-server listens privately at `127.0.0.1:4100`; no host `3002` or public `4100` endpoint is supported. The default Windows/WSL firewall and localhost-forwarding assumption is for local use only, not LAN, remote, shared, or untrusted access.
- **Embedding** — The trusted separate-origin iframe is unsandboxed and requests only `allow="clipboard-write"`; the page also offers a standalone/new-tab fallback. code-server provides the `/workspace` terminal and stock Open VSX/user-managed extension flow.
- **Theme defaults** — Use the code-free built-in `configurationDefaults` contribution to enable system color detection with **Dark Modern** and **Light Modern**. User and workspace settings override these defaults; never mutate User `settings.json` or workspace settings to enforce a theme.
- **Pinned extension** — `sst-dev.opencode@0.0.13` is baked from the official Open VSX VSIX (`https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix`, SHA-256 `e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4`) and installed offline/idempotently as `ingenium-vscode` into persistent `vscode-data`. Runtime registry installation is not supported; upgrades revalidate identity, engine, hash, and persistence.
- **Workspace trust** — The extension is preinstalled, but Restricted Mode disables it until the user explicitly trusts the workspace. Ingenium does not auto-trust. This is an administrator-grade local surface and must not be exposed to LAN, remote, shared, or untrusted users.

## DB Isolation
- Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries
- CI enforces: `grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/` must return empty
- Git-authoritative external-worktree synchronization is exactly Git worktree →
  `@ingenium/extension` resource-sync → configured MCP stdio → authenticated API
  → database. Runtime consumers never import core, read/write DB files, or call
  mutation REST endpoints directly. Administrative skill sync tools are repair/
  import operations only; use the API boundary for any such repair.

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

Observations are **server-recorded** with a file fallback: if the API is down, observations append to `.opencode/skills/observations.md`. On the next session start, `importObservationsFromFile()` in the observer plugin syncs file entries into the DB. The MCP tool is the primary source of truth; the file is a resilience layer.

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

The `engineering-workflow` canonical skill (which absorbed the former orchestrator-primer training) requires the primary engineering agent to call `ingenium_observe(observation_type="preference", ...)` after code changes (🔴 HARD RULE). The `development-conventions` skill extends this to all agents for any code change. The `skill-maintenance` skill adds auto-trigger instructions for logging when detection signals fire.

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
- **Skills live at `.opencode/skills/`** — Git worktree files are projected by the
  resource-sync plugin through MCP and the authenticated API. Do not run
  `ingenium_skill_sync*` after edits; those tools are admin repair/import paths.

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

## SSR Browser-Only State Guard — Deferred Resolution Pattern

Any state derived from browser-only APIs (`window`, `document`, `navigator`) **must be deferred to post-hydration** via `useState` + `useEffect`. Calling browser-only functions during render produces different SSR vs. client trees, causing React hydration error #418 ("Text content did not match").

### Pattern 1: Iframe `src` Deferred Resolution

Iframes with a dynamically-resolved `src` that depends on `window.location` **must defer URL resolution to after client hydration** to prevent the iframe from navigating to the SSR-generated fallback URL before React hydration replaces it.

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

### Pattern 2: Branching State Deferred (Availability / Feature Detection)

Browser-only query functions that determine **which component branch renders** (e.g., availability checks, feature detection) must also be deferred. During SSR the initial `useState` value must match the first client render. Both produce `null`/default → hydration matches; the effect resolves the real value on the client after hydration.

```tsx
"use client";
import { useState, useEffect } from "react";

export default function DynamicComponent() {
  // Availability starts as null on BOTH server and first client render,
  // producing identical DOM. The effect resolves post-hydration.
  const [availability, setAvailability] = useState<"ok" | "unavailable" | null>(null);

  useEffect(() => {
    setAvailability(getBrowserOnlyAvailability());
  }, []);

  if (availability === "unavailable") {
    return <GuidanceBanner />;
  }

  return <MainContent />;
}
```

**Failure scenario (hydrate #418):** If `getBrowserOnlyAvailability()` is called during render:
- SSR: `window` is undefined → returns `"unavailable"` → renders `<GuidanceBanner />`
- Client (first hydration render): `window` exists → returns `"ok"` → renders `<MainContent />`
- React detects mismatched DOM trees → throws error #418

**When to use this pattern:**
- Browser-only APIs called during render to determine which JSX branch to show
- Feature detection that differs between server and client environments
- Any state that depends on `typeof window === "undefined"` branching

**Components using this pattern:**
- `OpenCodeFrame.tsx` — OpenCode Web/CLI iframe URLs resolved post-hydration (Pattern 1); availability guard (`getOpenCodeAvailability()`) deferred via `useState(null)` + `useEffect` (Pattern 2)

## 🔴 Skill Data Integrity & Security Rules

These are non-negotiable rules enforced across core (`packages/ingenium-core/lib/tools/skills.ts`) and extension (`packages/ingenium-extension/resource-sync.ts`). Full detail at [skill-taxonomy.md](../reference/skill-taxonomy.md).

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
