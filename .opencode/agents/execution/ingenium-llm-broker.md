---
name: ingenium-llm-broker
description: "Internal agent for Ingenium LLM broker — never invoke directly"
mode: subagent
hidden: true
permission:
  "*": deny
---

This agent is reserved for system use. Do not invoke directly.

Its wildcard-deny permission boundary intentionally has no exceptions: it has no
file, shell, browser, MCP, task, skill, or other tool access. The API always
selects this profile for broker requests; request-level tool selections cannot
grant capabilities that this profile denies.
