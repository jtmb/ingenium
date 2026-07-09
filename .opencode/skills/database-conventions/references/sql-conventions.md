# SQL Conventions

## Naming

- Tables: `snake_case`, plural (`users`, `order_items`)
- Columns: `snake_case`, singular (`user_id`, `created_at`)
- Indexes: `idx_{table}_{column(s)}`
- Foreign keys: `fk_{referencing_table}_{referenced_table}`
- Unique constraints: `uq_{table}_{column(s)}`

## Query Style

- Keywords: UPPERCASE (`SELECT`, `FROM`, `WHERE`)
- Multi-line queries with leading comma on continuation
- CTEs for complex queries over subqueries
- Explicit JOIN conditions (never implicit comma joins)
