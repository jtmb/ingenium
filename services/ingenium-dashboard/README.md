# ingenium-dashboard

Next.js 16 App Router frontend for the Ingenium MCP Server. Accessible at `http://localhost:3000`.

**Primary navigation (24 routes):** Home, Chat, OpenCode, VS Code, Mail, Tasks, Docs, Skills, Agents, Observations, Personality, Context, Pipeline, Jobs, Backups, Logs, Usage, Status, Projects, Organizations, Plugins, MCP Servers, Config, Secrets.

The Settings overlay provides 20 URL-addressable tabs and is not counted as a
primary navigation route.

**Key constraints:**
- Zero direct database access — all data flows through the API layer
- Tailwind CSS v4 for all styling (no CSS modules, no inline styles, no custom CSS files)
- highlight.js for syntax highlighting (Preview and Source modes in skill detail overlay)

**Styling:** See `STYLING-GUIDE.md` for color palette, typography, grid layout, and immutables.

## Development

From the repository root:

```bash
npm run dev --workspace=services/ingenium-dashboard
npm run typecheck --workspace=services/ingenium-dashboard
npm run lint --workspace=services/ingenium-dashboard
npm run test --workspace=services/ingenium-dashboard
npm run build --workspace=services/ingenium-dashboard
```

Dashboard behavior is documented in [`docs/usage/dashboard.md`](../../docs/usage/dashboard.md),
settings in [`docs/configure/settings.md`](../../docs/configure/settings.md), and
verification selection in [`docs/develop/testing.md`](../../docs/develop/testing.md).
