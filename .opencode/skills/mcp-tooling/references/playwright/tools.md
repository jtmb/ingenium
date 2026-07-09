---
title: "Playwright MCP Tools — Complete Catalog"
impact: HIGH
impactDescription: "Provides an overview of each available browser automation tool"
tags: [playwright, mcp, tools, browser]
---

## Playwright MCP Tools Catalog

### Navigation & Page Load

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_navigate` | Navigate to a URL | `browser_navigate({ url: "http://localhost:3000" })` |

### DOM & Snapshot

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_snapshot` | Retrieve a simplified DOM/tree of the page | `browser_snapshot({})` — useful for inspecting element structure |
| `browser_evaluate` | Execute JavaScript in the browser context | `browser_evaluate({ script: "document.title" })` |

### Screenshots & Visual

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_take_screenshot` | Capture a full-page screenshot (requires `--caps=vision`) | `browser_take_screenshot({})` — returns image data |

### Interaction

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_click` | Click an element matching a CSS selector | `browser_click({ selector: "[data-testid=submit]" })` |
| `browser_type` | Type text into an input field | `browser_type({ selector: "#email", text: "test@example.com" })` |
| `browser_press_key` | Press a keyboard key | `browser_press_key({ key: "Enter" })` |
| `browser_hover` | Hover over an element | `browser_hover({ selector: ".menu-item" })` |

### Viewport & Responsive

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_resize` | Resize the browser viewport | `browser_resize({ width: 375, height: 812 })` |

### Debugging

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_console_messages` | Retrieve browser console log entries | `browser_console_messages({})` — useful for detecting JS errors |
| `browser_network_requests` | Retrieve captured network requests (varies by version) | `browser_network_requests({})` |

### Session Management

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_close` | Close the browser session | `browser_close({})` — always call after finishing |
