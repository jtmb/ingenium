---
name: sqlite-migration-patterns
description: "Patterns for safe SQLite database migrations, including handling foreign key constraints after table rename."
---

---
name: sqlite-migration-patterns
description: "Patterns for safe SQLite database migrations, including handling foreign key constraints after table rename."
created: 2026-07-11T19:01:12.561Z
---

# SQLite Migration Patterns

## 🔴 HARD RULEs
- When renaming a table with `ALTER TABLE RENAME`, all foreign key references to that table in other tables become dangling and must be repaired manually. Before renaming, disable foreign key enforcement (`PRAGMA foreign_keys=OFF`), then recreate the referenced table with the new name, and update all dependent tables' FK constraints.
- After any migration that changes table structure, re-enable foreign keys and verify integrity (`PRAGMA foreign_key_check`).

## Reference Files

| File | Content |
|------|--------|
| [`references/sqlite-fk-after-rename.md`](references/sqlite-fk-after-rename.md) | Detailed guide on repairing FK constraints after table rename in SQLite |
