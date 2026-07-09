# PostgreSQL Optimization

## Index Strategy

- **B-tree**: Default, good for equality and range queries
- **Hash**: Equality only, smaller footprint
- **GiST**: Full-text search, geometric data
- **GIN**: Array columns, full-text search (inverted index)
- **BRIN**: Large append-only tables (much smaller than B-tree)
- **SP-GiST**: Clustered data, partitioned trees

### Rule of Thumb
Index columns used in: WHERE, JOIN ON, ORDER BY, GROUP BY. Never index everything — each index slows writes.

## Query Tuning

1. Always run `EXPLAIN (ANALYZE, BUFFERS)` before optimizing
2. Look for sequential scans on large tables
3. Check for "Rows Removed by Filter" — signifies bad index choice
4. Monitor `shared_hit` vs `shared_read` — high reads indicate cache misses

## Connection Management

```sql
-- Set statement timeout (9s)
SET statement_timeout = '9000';

-- Set lock timeout (3s) 
SET lock_timeout = '3000';

-- Idle session timeout (30min)
SET idle_in_transaction_session_timeout = '1800000';
```

## Maintenance

- `VACUUM` — Reclaims storage, prevents transaction ID wraparound
- `ANALYZE` — Updates planner statistics
- `REINDEX` — Rebuilds corrupted or bloated indexes
- Auto-vacuum should be enabled but tuned for write-heavy workloads
