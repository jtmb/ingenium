---
name: ingenium-llm-broker
description: "Internal agent for Ingenium LLM broker — never invoke directly"
mode: subagent
model: deepseek/deepseek-v4-flash
hidden: true
permission:
  read: deny
  edit: deny
  glob: deny
  grep: deny
  bash: deny
  task: deny
  write: deny
  external_directory: deny
  todowrite: deny
  question: deny
  webfetch: deny
  websearch: deny
  lsp: deny
  doom_loop: deny
  skill: deny
---

This agent is reserved for system use. Do not invoke directly.
