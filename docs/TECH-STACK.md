# Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode, strictNullChecks)
- **Package Manager**: npm workspaces (monorepo)
- **API**: Express.js on port 4097
- **Database**: SQLite via better-sqlite3 with WAL mode + FTS5 full-text search
- **MCP**: @modelcontextprotocol/sdk for stdio transport (48 tools)
- **Frontend**: Next.js 16 App Router, React 19, Tailwind CSS 4
- **State / Persistence**: Thread MCP server for cross-session context
- **Container**: Docker multi-stage build, supervisord (API + Dashboard + opencode-server)
- **Testing**: Vitest, Playwright
- **Linting**: ESLint, TypeScript compiler
- **CI**: GitHub Actions (push to `ingenium-core`, `ingenium-api`, `ingenium-server`, `ingenium-dashboard`)
