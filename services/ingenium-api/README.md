# ingenium-api

Express REST API for the Ingenium MCP Server. Listens on port **4097**.

**Authority:** Sole database authority. All CRUD operations flow through this service.

**Features:**
- RESTful endpoints for skills, agents, plugins, tasks, commands, configs, observations, personality traits, email, and servers
- Scheduled maintenance (15-min interval) — extraction → synthesis → skill sync
- Health check endpoint at `/api/v1/health`
- CORS, rate limiting, and Bearer token authentication
- JSON body limit: 2MB (for large skill/plugin uploads)

**Isolation:** Dashboard and server import zero core/server code. All data flows through the API layer.
