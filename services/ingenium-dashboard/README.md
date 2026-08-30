# ingenium-dashboard

Next.js 16 App Router frontend for the Ingenium MCP Server. Accessible at `http://localhost:3000`.

**Primary navigation (24 routes):** Home, Chat, OpenCode, VS Code, Mail, Tasks, Docs, Skills, Agents, Observations, Personality, Context, Pipeline, Jobs, Backups, Logs, Usage, Status, Projects, Organizations, Plugins, MCP Servers, Config, Secrets.

The Settings overlay provides 19 URL-addressable tabs and is not counted as a
primary navigation route.

**Key constraints:**
- Zero direct database access — all data flows through the API layer
- Tailwind CSS v4 for all styling (no CSS modules, no inline styles, no custom CSS files)
- highlight.js for syntax highlighting (Preview and Source modes in skill detail overlay)

**Styling:** See `STYLING-GUIDE.md` for color palette, typography, grid layout, and immutables.
