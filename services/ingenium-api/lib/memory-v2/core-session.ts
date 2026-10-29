import { checkpointAfterWrite, execTransaction, explicitMemory, getDb } from "ingenium-core";
import { createApiMemorySession, type MemoryApiPorts } from "./adapters.mjs";
import type { SqlConnection, SqlStatement } from "./lifecycle.mjs";

type PositionalValue = string | number | null;
type CoreDatabase = ReturnType<typeof getDb>;
type CoreConnection = SqlConnection & { readonly inTransaction: boolean };
const connections = new WeakMap<CoreDatabase, CoreConnection>();

/** Preserve the core handle identity while selecting the positional statement
 * overload explicitly. No coercion or object-binding fallback changes nulls.
 */
export function positionalCoreConnection(database: CoreDatabase): CoreConnection {
  const existing = connections.get(database);
  if (existing) return existing;
  const connection: CoreConnection = {
    get inTransaction() { return database.inTransaction; },
    exec(sql: string) { database.exec(sql); },
    prepare(sql: string): SqlStatement {
      const statement = database.prepare<PositionalValue[]>(sql);
      return {
        run: (...values: PositionalValue[]) => statement.run(...values),
        get: (...values: PositionalValue[]) => statement.get(...values),
        all: (...values: PositionalValue[]) => statement.all(...values),
      };
    },
  };
  connections.set(database, connection);
  return connection;
}

/** Binds existing API persistence exports; the authenticated caller supplies the
 * actual execution, chat, authorization and source-state owners.
 */
export function createCoreMemorySession<RequestContext>(
  ports: Omit<MemoryApiPorts<RequestContext>, "core" | "resolveExistingScope">,
) {
  return createApiMemorySession({
    ...ports,
    core: { getDb: () => positionalCoreConnection(getDb()), execTransaction, checkpointAfterWrite },
    resolveExistingScope: explicitMemory.resolveExplicitMemoryScope,
  });
}
