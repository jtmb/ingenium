---
name: database-conventions
description: "Database conventions — SQL/PostgreSQL schema design, query optimization, SQLite WAL safety, migration management, FTS5 integrity. Use when writing SQL, designing schemas, writing migrations, or debugging database issues."
alwaysApply: true
tags: ["database", "sql", "postgresql", "sqlite", "migrations", "wal"]
---

# Database Conventions

> Unified database conventions across SQL/PostgreSQL design, SQLite WAL safety, migration management, and FTS5 integrity. Absorbed 4 legacy skills.

## When to Use

- Designing database schemas, tables, indexes, or constraints
- Writing SQL queries, migrations, or stored procedures
- Working with SQLite WAL mode, FTS5, or checkpoint safety
- Managing database migrations (numbered `.sql` files)
- Debugging SQLITE_LOCKED, constraint violations, or FTS corruption
- Optimizing query performance with EXPLAIN ANALYZE

## 🔴 HARD RULEs

### 🔴 Always Use Parameterized Queries

Never interpolate values into SQL strings. Use `?` placeholders or `$1` named parameters.

### 🔴 `checkpointAfterWrite()` Must Be OUTSIDE `execTransaction()`

Never call `checkpointAfterWrite()` inside an `execTransaction()` callback. This causes `SQLITE_LOCKED`. Always call it after the transaction commits.

### 🔴 FTS5 Triggers Are Sole Authority for FTS Writes

Never manually `INSERT INTO skills_fts`. The migration 024 AFTER INSERT/UPDATE/DELETE triggers are the sole authority. Zero manual FTS writes.

### 🔴 WAL Safety — Deferred Work After Commit

All disk I/O, checkpoint, and external service calls must happen AFTER `execTransaction()` completes. Deferred work includes: `writeSkillToDisk()`, `checkpointAfterWrite()`, REST calls, and any non-DB side effects.

### 🔴 Parent-Existence Check Before FK-Constrained Upserts

Any upsert into a FK-constrained child table must check for the parent row BEFORE inserting (prevents concurrent-deletion corruption).

### 🔴 `ON CONFLICT DO UPDATE`, Never `INSERT OR REPLACE`

`INSERT OR REPLACE` cascades to delete child rows. Use `ON CONFLICT(columns) DO UPDATE SET ...` instead.

## Reference Files

| File | Content |
|------|---------|
| [`references/postgresql-optimization.md`](references/postgresql-optimization.md) | PostgreSQL-specific optimization patterns |
| [`references/sql-conventions.md`](references/sql-conventions.md) | General SQL conventions |

## Migrated Sources (Phase 3 Taxonomy)

| Source | Content Preserved At |
|--------|---------------------|
| `database-migration-management` | [`references/sources/database-migration-management/`](references/sources/database-migration-management/source-index.md) |
| `sqlite-migration-patterns` | [`references/sources/sqlite-migration-patterns/`](references/sources/sqlite-migration-patterns/source-index.md) |
| `sqlite-wal-safety` | [`references/sources/sqlite-wal-safety/`](references/sources/sqlite-wal-safety/source-index.md) |

## Cross-References

- **`@development-conventions`** — API design patterns for database-backed services
- **`@engineering-workflow`** — Debugging database test failures, migration verification
- **`@skill-maintenance`** — Skill validation checklist for database conventions
