# MCP Tool Parity Audit

## Overview

The Ingenium MCP server should expose one MCP tool for every REST API endpoint. This skill documents the audit procedure.

## Audit Procedure

### 1. List all API routes
```bash
grep -rn "router\.(get|post|put|patch|delete)" services/ingenium-api/lib/routes/ --include="*.ts"
```

### 2. List all MCP tool registrations
```bash
grep -n "server\.(registerTool|tool)\(" services/ingenium-server/scripts/mcp-server.ts
```

### 3. List all MCP handlers
```bash
grep -rn "export async function" services/ingenium-server/lib/tools/ --include="*.ts"
```

### 4. Cross-reference

Compare the three lists:
- Every API route → should have an MCP handler
- Every MCP handler → should be registered in mcp-server.ts
- Every registration → should have a corresponding API route

### 5. Fill gaps

For each missing MCP tool:
1. Add handler to the appropriate tool file
2. Import in mcp-server.ts
3. Register with matching name
4. Build and verify

## 🔴 HARD RULE

All dashboard pages must have matching MCP tools. If no match exists for a dashboard feature, file a task to create one.
