# Historical provenance tombstone

This source is retained only as historical provenance. **Do not execute or
reinstate these instructions.** They described a superseded database-primary local
persistence model and are not an active synchronization policy.

The canonical path is:

```text
Git worktree files → @ingenium/extension resource-sync plugin → configured
Ingenium MCP stdio transport → authenticated Ingenium API → database
```

Git is authoritative. Administrative `ingenium_skill_*` CRUD/sync operations are
repair/import interfaces only. See `AGENTS.md` and
`docs/concepts/skill-system.md` for the active policy.
