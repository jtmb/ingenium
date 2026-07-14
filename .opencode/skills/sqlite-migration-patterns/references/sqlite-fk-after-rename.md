# SQLite FK Repair After Table Rename

## Problem
SQLite's `ALTER TABLE RENAME` does not update foreign key references in other tables that point to the renamed table. After renaming, those foreign keys still reference the old table name, leading to integrity errors.

## Steps to Repair
1. Disable foreign key enforcement: `PRAGMA foreign_keys=OFF`
2. Rename the referenced table (e.g., `old_table` → `new_table`)
3. Temporarily create a new table with the old name or directly update dependent tables:
   - Drop and recreate all dependent tables with corrected FK references pointing to `new_table`
   - Or use a sequence of `CREATE TABLE ... AS SELECT` and drop old tables
4. Re-enable foreign keys: `PRAGMA foreign_keys=ON`
5. Verify integrity: `PRAGMA foreign_key_check`

## Example
```sql
PRAGMA foreign_keys=OFF;
ALTER TABLE old_table RENAME TO new_table;
-- Assume table child has FK REFERENCES old_table(id)
CREATE TABLE child_new (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES new_table(id)
);
INSERT INTO child_new SELECT * FROM child;
DROP TABLE child;
ALTER TABLE child_new RENAME TO child;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
```
