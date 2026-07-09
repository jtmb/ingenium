# Database Conventions

Covers SQL and PostgreSQL-specific conventions for schema design, query optimization, and database operations.

## 🔴 HARD RULEs

- **Always use parameterized queries** — Never interpolate values into SQL strings. Use `?` placeholders or `$1` named parameters.
- **Always add indexes for foreign keys and high-cardinality columns** in query WHERE/JOIN/ORDER BY clauses.
- **Prefer UUID primary keys** over auto-increment integers for distributed systems.
- **Use `EXPLAIN ANALYZE`** before optimizing any query — never guess at performance.
- **Set `statement_timeout`** on all write operations to prevent long-held locks.

## PostgreSQL Optimization

- Use `VACUUM` and `ANALYZE` on schedules for write-heavy tables.
- Prefer `JSONB` over `JSON` for indexed JSON operations.
- Use `BRIN` indexes on append-only tables (time-series data).
- Connection pooling via PgBouncer or similar — never direct connections from serverless functions.
- Use `pg_stat_statements` for query performance monitoring.

## SQL Best Practices

- All text columns should specify `COLLATE` explicitly for consistent sorting.
- Use `GENERATED ALWAYS AS (...) STORED` for computed columns.
- Prefer `LEFT JOIN` over `NOT IN` for exclusion queries (NULL-safe).
- Use `COALESCE` for default values instead of application-layer null checks.
- Timestamps should be `TIMESTAMPTZ` (with timezone) in UTC.

## References

- See `references/postgresql-optimization.md` for PostgreSQL-specific patterns
- See `references/sql-conventions.md` for general SQL conventions
