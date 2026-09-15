type PluginLogLevel = "info" | "warn";

interface PluginLogClient {
  app?: {
    log?: (entry: { body: { service: string; level: PluginLogLevel; message: string } }) => unknown;
  };
}

/** Best-effort OpenCode lifecycle logging; plugin failures must never escape here. */
export function logPluginLifecycle(
  client: unknown,
  service: string,
  level: PluginLogLevel,
  message: string,
): void {
  const app = (client as PluginLogClient | undefined)?.app;
  if (typeof app?.log !== "function") return;

  try {
    void Promise.resolve(app.log({ body: { service, level, message } })).catch(() => undefined);
  } catch {
    // OpenCode logging is observability only; never recurse or write a diagnostic.
  }
}
