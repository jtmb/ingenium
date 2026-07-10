---
name: sqlite-wal-safety
description: "SQLite WAL mode transaction safety rules — checkpointAfterWrite must never run inside execTransaction to avoid SQLITE_LOCKED errors."
alwaysApply: true
tags: ["llm-synthesized", "auto-generated"]
---

# 🔴 HARD RULES
1. **NEVER call `checkpointAfterWrite()` inside `execTransaction()`** in SQLite/WAL mode.
2. The PRAGMA wal_checkpoint CANNOT execute while a write transaction holds the lock — this causes `SQLITE_LOCKED` on every write operation.
3. Always move checkpoint calls OUTSIDE the transaction callback scope.

## 📋 CORRECT PATTERN (✅)
```typescript
// ✅ SAFE: Checkpoint outside transaction
db.execTransaction(async () => {
  // Write operations only — no checkpoints here
  await db.run('INSERT INTO ...');
}, async (err) => {
  if (!err) checkpointAfterWrite(); // Move AFTER transaction completes
});
```

## ❌ INCORRECT PATTERN (⚠️)
```typescript
// ⚠️ UNSAFE: Checkpoint inside causes SQLITE_LOCKED
db.execTransaction(async () => {
  await db.run('INSERT INTO ...'); // Write holds lock
  checkpointAfterWrite(); // BLOCKS — deadlock!
});
```

## 🔧 WHY THIS MATTERS
- **Root Cause**: WAL mode requires exclusive access to checkpoint files during writes.
- **User Impact**: Every write operation fails with SQLITE_LOCKED error, breaking the entire session.
- **Fix Pattern**: Always defer checkpoints until after transaction commits successfully.
