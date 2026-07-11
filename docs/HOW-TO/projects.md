# HOW-TO: Projects

## What It Does

Manages project configurations. Each project has its own SQLite database containing skills, learnings, tasks, and servers. The dashboard provides Active/Archived tab views with rename, archive, restore, and purge actions.

## How to Use

1. Navigate to `/projects` from the dashboard nav bar
2. Type a project name in the input field and click **Create** to initialize a new project
3. The project appears in the Active list with its name and creation date
4. Toggle to the **Archived** tab to view archived projects
5. Use action buttons on each card:
   - **Rename** — update the project name inline
   - **Archive** — soft-delete (moves to Archived tab)
   - **Restore** — move back to Active (from Archived tab)

## Global vs Regular Projects

Projects can be either **regular** (default) or **global**.

### Regular Projects
- Skills, plugins, and commands are stored in the project's root directory
- Each project has its own isolated `.opencode/` directory
- Resources are not shared between projects

### Global Projects
- Marked with `is_global = true`
- Skills, plugins, and commands are written to `/home/appuser/.config/opencode/` (configurable via `INGENIUM_GLOBAL_CONFIG_PATH`)
- Resources are shared across **all** projects via shared skill resolution
- The `global-default` project is the primary global project
- Global servers appear with "Enabled" badge on the Servers page

### Making a Project Global

Using MCP tools:

```typescript
// Mark a project as the global-default
await ingenium_project_set_global({
  project: "my-project",
  name: "global-default",
  isGlobal: true
});

// Unmark a project
await ingenium_project_set_global({
  project: "my-project",
  name: "global-default",
  isGlobal: false
});
```

## Cross-Project Synthesis

When a project is marked as global, patterns discovered in one project can be shared across all projects:

1. The `ingenium_synthesis_cross_project` tool evaluates observations across all active projects
2. Shared patterns are synthesized into skills in the `global-default` project
3. All projects can access these global skills
4. Cross-project synthesis runs automatically every 15 minutes

## API Endpoints

- `GET /api/v1/projects` — list all active projects
- `POST /api/v1/projects` — create a new project (body: `{ name }`)
- `PATCH /api/v1/projects/:name` — rename a project (body: `{ name: newName }`)
- `DELETE /api/v1/projects/:name` — archive a project
- `POST /api/v1/projects/:name/restore` — restore an archived project
- `GET /api/v1/projects/archive` — list archived projects
- `POST /api/v1/projects/purge` — purge expired projects (body: `{ retention_days }`)

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ingenium_project_init` | `name, isGlobal?` | Create a new project (optionally global) |
| `ingenium_project_list` | — | List all active projects |
| `ingenium_project_delete` | `name` | Delete a project |
| `ingenium_project_list_archived` | `project` | List archived projects |
| `ingenium_project_restore` | `project, name` | Restore an archived project |
| `ingenium_project_purge` | `project, retentionDays?` | Permanently purge expired projects |
| `ingenium_project_set_global` | `project, name, isGlobal` | Mark/unmark a project as global |

## Code Location

- Page: `services/ingenium-dashboard/src/app/projects/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.projects`
- Route: `services/ingenium-api/lib/routes/projects.ts`
- Core: `packages/ingenium-core/lib/tools/projects.ts`
- Paths: `packages/ingenium-core/lib/tools/paths.ts`

## Related Docs

- [docs/HOW-TO/synthesis.md](synthesis.md) — Cross-project synthesis configuration
- STYLING-GUIDE.md — card grid and form styling rules
