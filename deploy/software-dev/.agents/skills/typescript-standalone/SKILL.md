---
name: typescript-standalone
description: "Standalone TypeScript conventions (non-Next.js) — strict tsconfig, type safety, error handling, async patterns, Node.js conventions, testing. Use when writing **/*.{ts,tsx} outside Next.js projects."
---

# TypeScript Conventions

## When to Use

Invoke this skill when writing standalone TypeScript (non-Next.js) — `**/*.{ts,tsx}`. Covers tsconfig, module systems, type safety, async patterns, and Node.js conventions.

## TypeScript Configuration

Your `tsconfig.json` must be strict.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

- **`strict: true`**: enables all strict type-checking flags
- **`noUncheckedIndexedAccess`**: `obj[key]` returns `T | undefined`
- **`noUnusedLocals`/`noUnusedParameters`**: dead code is a bug. Use `_` prefix for intentionally unused params.

## Type Safety — Mandatory

Never use `any` except at API boundaries with explicit justification.

```typescript
// Bad — any infects everything it touches
function process(data: any): any {
    return data.value;
}

// Good — use unknown and narrow
function process(data: unknown): string {
    if (typeof data === "object" && data !== null && "value" in data) {
        return String((data as { value: unknown }).value);
    }
    throw new Error("Invalid data");
}
```

- **Use `unknown` over `any`**: forces you to narrow the type before use
- **Use type predicates** for runtime validation:

```typescript
function isUser(obj: unknown): obj is User {
    return typeof obj === "object" && obj !== null && "id" in obj && "email" in obj;
}
```

- **Use branded types** for nominal typing:

```typescript
type UserId = string & { readonly __brand: "UserId" };
```

## Error Handling

Use typed errors, not string matching.

```typescript
class AppError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = "AppError";
    }
}

// Catch and handle by type, not message text
try {
    await doSomething();
} catch (err) {
    if (err instanceof AppError) {
        return { error: err.message, code: err.code };
    }
    throw err; // Re-throw unexpected errors
}
```

- **Never `catch (e)` without re-throwing or handling**
- **Use `instanceof` checks**, never `err.message.includes("timeout")`
- **Don't `throw` string literals**: always `throw new Error()`
- **Async functions**: always `await` or return

## Async Patterns

```typescript
// Bad — sequential when parallel is possible
const user = await fetchUser(id);
const posts = await fetchPosts(id);  // Waits for user to finish

// Good — parallel
const [user, posts] = await Promise.all([
    fetchUser(id),
    fetchPosts(id),
]);

// Good — timeout wrapper
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), ms)
    );
    return Promise.race([promise, timeout]);
}
```

- **`Promise.all` for independent operations**
- **`Promise.allSettled` when partial failure is OK**
- **Always add timeouts to external calls**
- **Don't mix `async/await` with `.then()` chains**

## Module System

- **Use ES modules**: `"type": "module"` in `package.json`
- **Avoid barrel files** (`index.ts` re-exporting everything): they cause circular dependencies
- **One export per file is fine**: explicit imports are more maintainable
- **Use path aliases sparingly**: relative imports are refactor-safe

## Node.js Conventions

- **Use `node:` prefix for built-in modules**: `import fs from "node:fs"`
- **Prefer `fs/promises` over `fs` callbacks**
- **Use `AbortController` for cancellable operations**
- **Handle uncaught exceptions**:

```typescript
process.on("uncaughtException", (err) => {
    logger.fatal("Uncaught exception", { err });
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    logger.fatal("Unhandled rejection", { reason });
    process.exit(1);
});
```

## Testing

- **Use `vitest` or `jest`**
- **Mock at the boundary**: mock HTTP calls, DB queries, file I/O. Don't mock your own types.
- **Use `zod` schemas in tests**: validate API responses match the expected shape

```typescript
const UserSchema = z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    createdAt: z.string().datetime(),
});
const user = await api.getUser("42");
expect(() => UserSchema.parse(user)).not.toThrow();
```

## Styling & Organization

- **File naming**: kebab-case (`user-service.ts`, `auth-middleware.ts`)
- **Type files**: co-located with the code they type. Use `types.ts` only for shared types.
- **Constants**: UPPER_CASE for primitives, PascalCase for object constants
- **Enums**: prefer `as const` objects over TypeScript enums

```typescript
const Status = {
    Active: "active",
    Inactive: "inactive",
} as const;
type Status = (typeof Status)[keyof typeof Status];
```
