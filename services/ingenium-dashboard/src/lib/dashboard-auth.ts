/**
 * Browser/server contract for requests handled by the dashboard API proxy.
 *
 * The marker is not a secret. It is a deliberately explicit signal that the
 * request came through the dashboard client. Mutation requests additionally
 * require a same-origin Origin header in the server-side proxy; the proxy
 * replaces this header with the canonical value before forwarding the request.
 */
export const DASHBOARD_MARKER_HEADER = "x-ingenium-ui";
export const DASHBOARD_MARKER_VALUE = "dashboard";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Return true for methods that can change API state. */
export function isUnsafeDashboardMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}
