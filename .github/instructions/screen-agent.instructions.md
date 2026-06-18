---
description: "Screen Agent project-specific rules: tool registration, settings fields, MCP integration, CSS conventions, and documentation map. Use when working in src/sidepanel/, lib/, background.js, or any tool-related code."
applyTo: ["src/sidepanel/**", "lib/**", "background.js"]
---

# Screen Agent — Project-Specific Conventions

## Tool Registration Steps

When adding a new tool to the screen agent, follow this registration order:

1. Define the tool in the tool registry with name, description, and parameter schema
2. Implement the handler — each tool has exactly one handler function
3. Register the handler in the tool dispatcher so the agent loop can route to it
4. If the tool needs browser access, register the background script handler

## Settings / Configuration Fields

Every tool setting requires these three fields in the settings schema:
- A unique key (snake_case, prefixed with tool category)
- A human-readable label
- A default value appropriate for the tool's behavior

Never remove a settings field without checking whether any tool references it.

## MCP (Model Context Protocol) Tool Notes

- MCP tools are registered separately from built-in tools
- Each MCP tool needs a `serverName` and `toolName` pair for routing
- MCP tool results pass through the same result pipeline as built-in tools
- Result handling: no truncation, no field stripping — raw JSON to the model

## CSS Conventions for Sidepanel

- All sidepanel styles live in `src/sidepanel/styles/`
- Use CSS custom properties for theme values (colors, spacing, typography)
- Layout uses CSS Grid for the main panel structure
- Component-specific styles are co-located with the component file (`.module.css`)
- No inline styles — use CSS Modules or utility classes

## Documentation Map

| Doc | Covers |
|-----|--------|
| `docs/ARCHITECTURE.md` | Agent loop, tool dispatch, communication flow between sidepanel and background |
| `docs/TECH-STACK.md` | Extension APIs used, key dependencies, browser compat targets |
| `docs/TOOLS.md` | Complete tool index with parameter schemas and handler locations |
