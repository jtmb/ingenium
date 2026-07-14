# ingenium-server

MCP stdio server with 73 tools. Calls the API via HTTP. Zero DB access.

## Architecture

- **Protocol**: MCP stdio — communicates over stdin/stdout
- **API dependency**: All data operations proxy through `services/ingenium-api` on :4097
- **DB isolation**: Enforced by CI check — must not import SQLite libraries

## Tools

73 tools across 15 categories (email, skills, agents, plugins, commands, servers, configs, observations, personality, synthesis, projects, settings, extraction, tasks, context). All tools are wrapped with `wrapHandler()` — if a tool is disabled for the project, it returns a `TOOL_DISABLED` error.

## Configuration

Installed via the `@ingenium/extension` npm package:
```bash
npx -y @ingenium/extension
```

MCP client config (in `opencode.json`):
```jsonc
{
  "mcp": {
    "servers": {
      "ingenium": {
        "type": "local",
        "command": ["npx", "-y", "@ingenium/extension"],
        "disabled": false,
        "env": {
          "INGENIUM_API_URL": "http://localhost:4097/api/v1",
          "INGENIUM_API_TIMEOUT": "10000",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```
