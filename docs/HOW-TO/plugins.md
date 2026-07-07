# HOW-TO: Plugins

## What It Does
Manages OpenCode plugins. Each plugin is a TypeScript file in `.opencode/plugins/`. Plugins can be enabled (file written to disk) or disabled (file removed).

## How to Use
1. Navigate to `/plugins` from the dashboard nav bar
2. Each plugin shows its name, file path, and a toggle button
3. Click **Enabled** to disable a plugin (removes its `.ts` file)
4. Click **Disabled** to enable a plugin (writes its `.ts` file to disk)

## API Endpoints
- `GET /api/v1/plugins?project=<name>` — list plugins
- `POST /api/v1/plugins/:name/enable?project=<name>` — enable plugin
- `POST /api/v1/plugins/:name/disable?project=<name>` — disable plugin

## Code Location
- Page: `services/ingenium-dashboard/src/app/plugins/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.plugins`
- Route: `services/ingenium-api/lib/routes/plugins.ts`
- Core: `packages/ingenium-core/lib/tools/plugins.ts`

## Related Docs
- STYLING-GUIDE.md — toggle button styling
