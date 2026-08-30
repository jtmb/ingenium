# ingenium-server

MCP stdio server with 281 catalog tools. Calls the API via HTTP. Zero DB access.

## Architecture

- **Protocol**: MCP stdio — communicates over stdin/stdout
- **API dependency**: All data operations proxy through the authenticated boundary on :4097 to private Express :4096
- **DB isolation**: Enforced by CI check — must not import SQLite libraries

## Tools

281 server tools across the 30 baseline catalog categories. The complete built-in catalog contains 283 entries after adding the two extension tools (`synthesize_observations` and `auto_observe_now`). All server tools are wrapped with `wrapHandler()` — if a tool is disabled for the project, it returns a `TOOL_DISABLED` error.

## Configuration

Installed via the `@ingenium/extension` npm package:
```bash
npx -y @ingenium/extension
```

MCP client config (in `opencode.json`):
```jsonc
{
  "mcp": {
    "ingenium": {
      "type": "local",
      "command": ["npx", "-y", "@ingenium/extension"],
      "enabled": true,
      "environment": {
        "INGENIUM_API_URL": "http://localhost:4097/api/v1",
        "INGENIUM_MCP_CREDENTIAL": "{file:.opencode/.ingenium-mcp-credential}",
        "INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential",
        "INGENIUM_API_TIMEOUT": "10000",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```
