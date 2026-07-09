---
name: containerized-agents
description: "Docker containerization for AI agent services — service skeleton structure, multi-stage Dockerfiles, Docker Compose multi-agent orchestration, bridge networking, named volumes. Use when deploying agent services in containers."
---

# Containerized Agents — Docker for Agent Services

## When to Use

- Containerizing agent-based services with state persistence
- Setting up Docker Compose stacks for multi-agent systems
- Designing service skeletons for agent runtime
- Configuring inter-agent networking in containers

## Containerized Agents

Each agent service runs in its own container. Docker Compose orchestrates the stack.

### Service Skeleton

```
agent-service/
├── AGENTS.md           # Agent instructions (read by Cline CLI / agent runtime)
├── Dockerfile           # Multi-stage: agent runtime + app deps
├── db.md                # Agent's local registry (tracks completed work)
├── scripts/
│   └── agent-runner.js  # Loop logic, checkpointing, API calls
├── config/
│   ├── .env             # LLM endpoint, API keys, batch size
│   └── settings.json    # Agent runtime settings (model, context window)
└── data/                # Mounted volume — generated artifacts, state files
```

**Rules:**
- **AGENTS.md is the agent's system prompt.** It defines role, workflow, constraints, and output format.
- **db.md is the agent's memory.** Tracks what's been processed — prevents duplicates.
- **agent-runner.js is the control loop.** Not the agent itself — it calls the agent CLI, checkpoints state, handles crashes.
- **data/ is a volume.** Survives container restarts. Contains state JSON, generated files, logs.
- **Multi-stage Dockerfile.** First stage installs agent CLI (Cline, etc.), second stage is the slim Node.js/Python runtime.

### Docker Compose Pattern

```yaml
services:
  agent-planner:
    build: ./agent-planner
    volumes:
      - planner-data:/app/data
    environment:
      - LLM_ENDPOINT=http://lm-studio:1234/v1
      - ORCHESTRATOR_URL=http://orchestrator:3444
    networks:
      - agent-net
    depends_on:
      orchestrator:
        condition: service_healthy

  agent-builder:
    build: ./agent-builder
    volumes:
      - builder-data:/app/data
    environment:
      - LLM_ENDPOINT=http://lm-studio:1234/v1
      - ORCHESTRATOR_URL=http://orchestrator:3444
    networks:
      - agent-net
    depends_on:
      orchestrator:
        condition: service_healthy

  orchestrator:
    build: ./orchestrator
    ports:
      - "3444:3444"
    volumes:
      - orchestrator-data:/app/data
    networks:
      - agent-net

networks:
  agent-net:
    driver: bridge

volumes:
  planner-data:
  builder-data:
  orchestrator-data:
```

**Rules:**
- **Bridge network for all agent services.** No `host` networking — services discover each other by container name.
- **Named volumes for agent data.** Not bind mounts — Docker manages lifecycle.
- **depends_on with healthcheck.** Agents wait for orchestrator to be healthy before starting.
- **LLM endpoint is an env var.** Never hardcoded. Allows swapping between local and cloud LLMs.

## Cross-References

- **`agent-checkpoints`** — State persistence that maps to Docker volumes
- **`build-pipelines`** — Build pipeline phases that containerized agents execute
- **`configuring-opencode`** — Agent frontmatter conventions
- **`devops-conventions`** — Docker authoring and management best practices
