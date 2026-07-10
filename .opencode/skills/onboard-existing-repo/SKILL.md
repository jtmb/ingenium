# Onboard Existing Repo

Guide for onboarding an existing codebase into the Ingenium skill/plugin/agent ecosystem.

## Steps

### 1. Initialize the project
```bash
ingenium_project_init(project="{project-name}")
```

### 2. Set the project root
```bash
ingenium_setting_set(project="{project-name}", key="project_root", value="/path/to/repo")
```

### 3. Scan for existing structure
Use `@ingenium-explore` to understand the project structure, build system, and key conventions.

### 4. Create initial skills
Run `ingenium_ingenium_synthesis_run(project="{project-name}")` after logging a few observations.

### 5. Bootstrap agents
Create `.opencode/agents/` files for orchestrator, engineers, QA, etc. in the project.

### 6. Enable plugins
Set up `.opencode/plugins/` with the learnings pipeline for self-improvement.
