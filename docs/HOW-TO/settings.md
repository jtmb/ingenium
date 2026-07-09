# Settings

The Ingenium MCP Server provides tools for managing project settings.

## MCP Tools

| Tool | Description |
|------|-------------|
| `ingenium_setting_get(project, key)` | Get a setting value by key |
| `ingenium_setting_set(project, key, value)` | Set a setting value |

## Usage

```typescript
// Get a setting
const value = await ingenium_setting_get({ project: "my-project", key: "theme" });

// Set a setting
await ingenium_setting_set({ project: "my-project", key: "theme", value: "dark" });
```

Settings are stored per-project in the Ingenium SQLite database.
