---
title: Projects
description: Project management — create, rename, archive, restore, and configure global projects.
---

# HOW-TO: Projects

## What It Does

Manages project configurations. Each project has its own SQLite database containing skills, observations, tasks, and servers. The dashboard provides Active/Archived tab views with rename, archive, restore, and purge actions.

## How to Use

1. Navigate to `/projects` from the dashboard nav bar
2. Type a project name in the input field and click **Create** to initialize a new project
3. The project appears in the Active list with its name and creation date
4. Toggle to the **Archived** tab to view archived projects
5. Use action buttons on each card:
   - **Rename** — update the project name inline
   - **Archive** — soft-delete (moves to Archived tab)
   - **Restore** — move back to Active (from Archived tab)

The default project listing is the **Active** list: archived projects are
excluded. Use the **Archived** tab or the archive-list endpoint when you need
to restore one.

## Global vs Regular Projects

Projects can be either **regular** (default) or **global**.

### Regular Projects
- Skills, plugins, and commands are stored in the project's root directory
- Each project has its own isolated `.opencode/` directory
- Resources are not shared between projects

### Global Projects
- Marked with `is_global = true`
- In Docker, skills, plugins, and commands are written to `/home/ingenium-opencode/.config/opencode/` (configurable via `INGENIUM_GLOBAL_CONFIG_PATH`)
- Resources are shared across **all** projects via shared skill resolution
- The active global namespace is singular: the database permits at most one
  non-archived `is_global` project, normally `global-default`
- If legacy data contains multiple active globals, runtime resolution fails
  closed instead of selecting one arbitrarily; repair the designation before
  using shared settings or mail
- Global servers appear with "Enabled" badge on the Servers page

### Protected global project lifecycle

The canonical `global-default` project is owned by the trusted server lifecycle.
External API and MCP lifecycle requests cannot create a global project, rename or
archive the canonical global, restore it, or change its global designation. Such
requests fail closed with `GLOBAL_PROJECT_LIFECYCLE_FORBIDDEN`; the global
namespace remains singular and server-managed.

Regular projects can be archived and restored. Archive/restore actions require
the caller's project authorization and, for browser administration, a recent
step-up. The active list excludes archived projects, while the Archived tab and
`GET /api/v1/projects/archive` provide the reversible restore path.

## Cross-Project Synthesis

When the trusted server lifecycle has an active canonical global project, patterns
discovered in one project can be shared across all projects:

1. The `ingenium_synthesis_cross_project` tool evaluates observations across all active projects
2. Shared patterns create pending skill proposals in the `global-default` project
3. Approved proposals apply global skills that all projects can access
4. Cross-project synthesis runs automatically every 15 minutes

## API Endpoints

- `GET /api/v1/projects` — list all active projects
- `POST /api/v1/projects` — create a new project (body: `{ name }`)
- `PATCH /api/v1/projects/:name` — rename a project (body: `{ name: newName }`)
- `DELETE /api/v1/projects/:name` — archive a project
- `POST /api/v1/projects/:name/restore` — restore an archived project
- `GET /api/v1/projects/archive` — list archived projects
- `POST /api/v1/projects/purge` — purge expired projects (body: `{ retention_days }`)

The canonical global project is protected from these external lifecycle changes;
the API returns `403 GLOBAL_PROJECT_LIFECYCLE_FORBIDDEN` rather than silently
changing the shared namespace. Regular archive/restore mutations are subject to
authorization and recent-step-up policy.

The dashboard URL-encodes validated project names used in path segments, so
archive, restore, rename, detail, and one-project purge work with any name that
passes project-name validation. Purge retention is an integer from **0 through
3,650 days inclusive**; the default is 7 days. A project is eligible only when
its archive timestamp is older than the selected retention cutoff, and projects
with referenced child data are retained.
Immutable security audit rows retain their historical project UUID after purge
but do not count as live child data. New audit rows still require an existing
project in the same organization, and the audit rows themselves remain
update/delete protected.

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ingenium_project_init` | `name, isGlobal?` | Create a regular project; external global creation is rejected |
| `ingenium_project_list` | — | List all active projects |
| `ingenium_project_delete` | `name` | Delete a project |
| `ingenium_project_list_archived` | `project` | List archived projects |
| `ingenium_project_restore` | `project, name` | Restore an archived project |
| `ingenium_project_purge` | `project, retentionDays?` | Permanently purge expired projects |
| `ingenium_project_set_global` | `project, name, isGlobal` | Forward an API-enforced global-lifecycle request; ordinary external designation changes are rejected |

## Code Location

- Page: `services/ingenium-dashboard/src/app/projects/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.projects`
- Route: `services/ingenium-api/lib/routes/projects.ts`
- Core: `packages/ingenium-core/lib/tools/projects.ts`
- Paths: `packages/ingenium-core/lib/tools/paths.ts`

## Related Docs

- [synthesis.md](synthesis.md) — Cross-project synthesis configuration
