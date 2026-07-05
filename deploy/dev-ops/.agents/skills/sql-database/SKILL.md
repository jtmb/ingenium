---
name: sql-database
description: "SQL & database conventions — parameterized queries, migration safety, indexing, connection pooling, query performance. Use when writing **/*.sql files or database migrations."
---

# SQL & Database Conventions

## When to Use

Invoke this skill when writing SQL or database migrations (`**/*.sql`). Covers security, performance, schema design, and migration practices.

## Parameterized Queries — Mandatory

Never concatenate user input into SQL strings. This is the #1 security vulnerability.

```sql
-- Bad — SQL injection
SELECT * FROM users WHERE email = '${email}';

-- Good — parameterized (placeholder syntax varies by driver)
SELECT * FROM users WHERE email = ?;
```

- Use parameterized queries everywhere: `?` (MySQL/SQLite), `$1` (Postgres), `:name` (named params)
- ORMs: ensure the ORM parameterizes. Raw queries still need placeholders.
- **No dynamic table/column/group BY names from user input** — use allowlists for these
- Stored procedures: use parameterized calls, never `EXEC` with string concatenation

## Migration Safety — Mandatory

Every migration must be reversible and non-destructive.

```sql
-- Migration: add column (safe, non-blocking)
ALTER TABLE users ADD COLUMN preferences JSONB DEFAULT '{}' NOT NULL;

-- Migration: drop column (DANGEROUS — requires multi-step)
-- Step 1: Stop writing to column in application code. Deploy.
-- Step 2: Migration to drop column (only after confirming no reads/writes).
```

- **Never drop a column or table in the same migration that adds it**
- **Never rename a column**: add new column, dual-write, migrate data, remove old column
- **Backfill large tables in batches**, not in a single transaction
- **Always add a default value** for new NOT NULL columns
- **Test rollback**: every `up` migration must have a tested `down` migration

## Indexing

```sql
-- Covering index for common query pattern
CREATE INDEX idx_users_email_status ON users (email, status);

-- Partial index — only indexes rows matching condition (smaller, faster)
CREATE INDEX idx_orders_pending ON orders (created_at)
    WHERE status = 'pending';

-- Index on expression (Postgres)
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
```

- **Index columns used in WHERE, JOIN, ORDER BY**
- **Multi-column index column order matters**: most selective columns first
- **Check the query plan**: `EXPLAIN ANALYZE` before and after adding indexes
- **Don't over-index**: every index slows down INSERT/UPDATE/DELETE
- **Remove unused indexes**: they waste disk space and write performance

## Connection Pooling

- Use the framework's connection pool
- Pool size: start with `(2 * CPU cores) + 1` for active connections
- Connection timeout: 30 seconds max
- Statement timeout: set at the pool level to prevent runaway queries
- Never leak connections: use `try-with-resources`, `defer`, or context managers

## Transaction Boundaries

Every write that touches multiple rows or tables needs a transaction.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

- **Wrap related writes in transactions** — partial writes corrupt data
- **Keep transactions short**: no API calls, no file I/O, no user input inside a transaction
- **Use the right isolation level**: `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`
- **Handle rollback gracefully**: catch errors, rollback, return a meaningful error

## N+1 Prevention

One query that returns 100 rows beats 100 queries that return 1 row.

```sql
-- Bad — N+1
SELECT * FROM users;
SELECT * FROM posts WHERE user_id = 1;
SELECT * FROM posts WHERE user_id = 2;

-- Good — one query with JOIN
SELECT u.*, p.* FROM users u
LEFT JOIN posts p ON p.user_id = u.id;
```

- **JOIN instead of loop**
- **IN clause for batches**
- **Eager loading** in ORMs
- **Lazy loading is a trap** — always wrong at scale

## Query Performance

- **Never `SELECT *` in production code**: return only the columns you need
- **Avoid functions on indexed columns in WHERE**
- **`LIKE '%prefix'` can't use an index**: use full-text search or trigram indexes
- **`LIMIT` without `ORDER BY` is non-deterministic**
- **`OFFSET` is slow for deep pages**: use cursor-based pagination

## Schema Design

- **Use UUIDs or ULIDs for primary keys** on user-facing entities
- **Choose the right data type**: `TEXT` not `VARCHAR(255)`, `BIGINT` for IDs, `TIMESTAMPTZ` not `TIMESTAMP`
- **Add `created_at` and `updated_at` to every table**
- **Normalize by default**: no JSON blobs for structured data
- **Foreign keys**: always declare them. Index FK columns.
