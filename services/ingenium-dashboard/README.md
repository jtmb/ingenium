# ingenium-dashboard

Next.js 16 App Router frontend for the Ingenium MCP Server. Accessible at `http://localhost:3000`.

**Pages (17 route-based):** Home, OpenCode iframe, Projects, Skills, Jobs, Logs, Mail, Status, Tasks, Plugins, Agents, MCP Servers, Config, Observations, Personality, Pipeline, Settings.

**Key constraints:**
- Zero direct database access — all data flows through the API layer
- Tailwind CSS v4 for all styling (no CSS modules, no inline styles, no custom CSS files)
- highlight.js for syntax highlighting (Preview and Source modes in skill detail overlay)

**Styling:** See `STYLING-GUIDE.md` for color palette, typography, grid layout, and immutables.
