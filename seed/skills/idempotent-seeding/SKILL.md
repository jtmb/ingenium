# Idempotent Seeding

## Overview

Seed data is loaded via the `./run.sh seed` command. Every seedable entity uses `INSERT OR IGNORE` so re-running seed is safe.

## Pattern

### 1. Core seed function (packages/ingenium-core/lib/seed.ts)

```typescript
export function seedEntityType(projectId: string, seedDir: string): number {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    if (!existsSync(seedDir)) {
      logger.warn({ seedDir }, "Directory not found, skipping");
      return 0;
    }
    const entries = readdirSync(seedDir, { withFileTypes: true });
    for (const entry of entries) {
      // Filter and read files
      const id = randomUUID();
      db.prepare(`INSERT OR IGNORE INTO table (...) VALUES (...)`, ...).run(...);
    }
    checkpointAfterWrite();
    return count;
  });
}
```

### 2. Export from index.ts
```typescript
export { seedEntityType } from "./seed.js";
```

### 3. Wire into run.sh
```bash
const { seedSkills, seedPlugins, seedEntityType } = require('.../seed.js');
// Add after existing seed calls
const e = seedEntityType(project.id, '/path/to/seed/dir');
console.log('Seeded', e, 'entities');
```

## Existing Seed Entities

| Entity | Seed function | Seed directory |
|--------|---------------|----------------|
| Skills | seedSkills() | seed/skills/ |
| Plugins | seedPlugins() | seed/plugins/ |

## 🔴 HARD RULE

All seed functions must use `INSERT OR IGNORE`. Never use bare `INSERT` — re-running seed must be safe.