import { NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_MARKER_HEADER,
  DASHBOARD_MARKER_VALUE,
  isUnsafeDashboardMethod,
} from "./lib/dashboard-auth";
import {
  getDashboardAllowedOrigins,
  isTrustedDashboardOrigin,
  parseExactDashboardOrigin,
} from "./lib/dashboard-origins";
import { loadDashboardApiToken } from "./lib/dashboard-token";
import { safeReturnTo } from "./lib/safe-return-to";

export { safeReturnTo } from "./lib/safe-return-to";

export {
  DASHBOARD_MARKER_HEADER,
  DASHBOARD_MARKER_VALUE,
  isUnsafeDashboardMethod,
} from "./lib/dashboard-auth";

/**
 * Keep the API proxy scoped to the dashboard API namespace. In particular,
 * `/auth/callback` is intentionally not matched: native OAuth callbacks are
 * public API gateway traffic and must continue to be handled by the API's
 * callback route without dashboard proxy authentication.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|navigation-prepaint.js).*)"],
};

export const DASHBOARD_API_PROXY_ERROR_CODE = "DASHBOARD_API_PROXY_MISCONFIGURED";
export const DASHBOARD_API_PROXY_ERROR_STATUS = 503;
export const DASHBOARD_CSRF_ERROR_CODE = "DASHBOARD_API_PROXY_CSRF_REJECTED";
export const DASHBOARD_CSRF_ERROR_STATUS = 403;
export const AUTH_SESSION_COOKIE = "__Host-ingenium_session";
export const PUBLIC_AUTH_PATHS = new Set([
  "/login", "/bootstrap", "/forgot-password", "/reset-password",
  "/verify-email", "/invitation", "/mfa", "/auth/oidc/callback",
]);

const FORWARDED_ORIGIN_HEADERS = [
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
] as const;

/**
 * This header is accepted only by the non-`/api/v1` child-MCP runtime handoff.
 * The dashboard must never relay a browser-supplied value if a future rewrite
 * configuration is broadened accidentally.
 */
const SERVER_ONLY_HANDOFF_HEADERS = [
  "x-ingenium-child-mcp-runtime",
  "x-ingenium-audience",
  "x-ingenium-private-network",
  "x-ingenium-runtime-gateway",
  "x-ingenium-workspace",
  "x-ingenium-launcher-worktree",
] as const;

type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the server-only API credential at request time.
 *
 * The token is deliberately resolved from the protected file path in the
 * dashboard server environment, not from a NEXT_PUBLIC variable or the browser
 * request. Reading it per request also keeps local runtime configuration
 * changes from being captured in a client-facing module constant.
 */
export function getDashboardApiToken(
  environment: ProxyEnvironment = process.env,
): string | null {
  return loadDashboardApiToken(environment);
}

/**
 * Build the request headers used by the internal API rewrite.
 *
 * Authorization is removed before the server credential is installed. This
 * makes the server token authoritative even when a browser sends its own
 * Authorization header, including a differently-cased header name.
 */
export function buildDashboardApiProxyHeaders(
  incoming: Headers,
  token: string | null,
): Headers {
  const headers = new Headers(incoming);
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete(DASHBOARD_MARKER_HEADER);
  for (const header of SERVER_ONLY_HANDOFF_HEADERS) headers.delete(header);
  // These values are trusted only at the Nginx → Next boundary while deriving
  // the external Origin below. Do not let a downstream service accidentally
  // treat them as a client identity or proxy-chain assertion.
  for (const header of FORWARDED_ORIGIN_HEADERS) headers.delete(header);
  headers.set(DASHBOARD_MARKER_HEADER, DASHBOARD_MARKER_VALUE);
  headers.set("x-ingenium-internal-service", "1");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function missingTokenResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: DASHBOARD_API_PROXY_ERROR_CODE,
        message: "Dashboard API proxy is not configured",
      },
    },
    {
      status: DASHBOARD_API_PROXY_ERROR_STATUS,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function csrfRejectedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: DASHBOARD_CSRF_ERROR_CODE,
        message: "Dashboard mutations require a same-origin request and a valid dashboard marker",
      },
    },
    {
      status: DASHBOARD_CSRF_ERROR_STATUS,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    },
  );
}

function authenticationRequiredResponse(): NextResponse {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

function gatewayPrivateResponse(): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Resource not found" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function isRuntimeGatewayPrivatePath(pathname: string): boolean {
  return pathname.startsWith("/api/v1/runtimes/gateway/");
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

function protectDashboardPage(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/v1")) return null;
  const authenticated = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  if (!authenticated && !isPublicAuthPath(pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", safeReturnTo(`${pathname}${request.nextUrl.search}`));
    return NextResponse.redirect(login);
  }
  if (authenticated && (pathname === "/login" || pathname === "/bootstrap")) {
    return NextResponse.redirect(new URL(safeReturnTo(request.nextUrl.searchParams.get("returnTo")), request.url));
  }
  return NextResponse.next();
}

/**
 * Return one Nginx-overwritten forwarding header value. Fetch combines
 * duplicate header fields with commas, so rejecting commas rejects both
 * multi-valued metadata and a malformed scalar value.
 */
function singleForwardedHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value || value !== value.trim() || value.includes(",") || /\s/.test(value)) {
    return null;
  }
  return value;
}

/**
 * A direct dashboard listener has no reverse-proxy metadata. Any presence of
 * a forwarding-origin field therefore selects the Nginx validation path,
 * including when the value is blank, partial, malformed, or multi-valued.
 * This prevents a malformed caller-supplied header from downgrading a proxied
 * request to the direct-listener fallback.
 */
function hasForwardedOriginMetadata(headers: Headers): boolean {
  if (!FORWARDED_ORIGIN_HEADERS.some((header) => headers.has(header))) return false;
  return !hasNextDirectListenerDefaults(headers);
}

/**
 * Next.js populates the standard X-Forwarded origin fields for every direct
 * Node listener request before Proxy runs. Those defaults do not establish a
 * reverse-proxy chain: they copy the direct Host (including its dynamic port).
 * Nginx instead supplies a port-free external host and a separate port. Treat
 * only this exact Next-generated shape as absent metadata; partial, malformed,
 * multi-valued, and normal forwarded values remain metadata and fail closed.
 */
function hasNextDirectListenerDefaults(headers: Headers): boolean {
  const proto = singleForwardedHeader(headers, "x-forwarded-proto");
  const forwardedHost = singleForwardedHeader(headers, "x-forwarded-host");
  const forwardedPort = singleForwardedHeader(headers, "x-forwarded-port");
  const requestHost = singleForwardedHeader(headers, "host");
  if (!proto || !forwardedHost || !forwardedPort || !requestHost) return false;
  if (proto !== "http" && proto !== "https") return false;

  try {
    const requestUrl = new URL(`${proto}://${requestHost}`);
    return (
      !requestUrl.username
      && !requestUrl.password
      && requestUrl.pathname === "/"
      && !requestUrl.search
      && !requestUrl.hash
      && requestUrl.host === requestHost
      && requestUrl.port === forwardedPort
      && forwardedHost === requestHost
    );
  } catch {
    return false;
  }
}

/**
 * Reconstruct the browser-visible origin from the dashboard gateway metadata.
 * Nginx clears caller-supplied forwarding headers and writes each of these
 * fields itself before the request reaches Next. The standalone Next server
 * sees its private :3001 URL, which must never be used for browser CSRF.
 */
export function externalOriginFromForwardedHeaders(headers: Headers): string | null {
  const proto = singleForwardedHeader(headers, "x-forwarded-proto");
  const host = singleForwardedHeader(headers, "x-forwarded-host");
  const port = singleForwardedHeader(headers, "x-forwarded-port");
  if (!proto || !host || !port || (proto !== "http" && proto !== "https")) return null;
  if (!/^[1-9]\d{0,4}$/.test(port)) return null;

  const portNumber = Number(port);
  if (!Number.isSafeInteger(portNumber) || portNumber > 65_535) return null;

  try {
    // The host and port must arrive in separate, canonical headers. Supplying
    // an authority with a port, credentials, a path, or a fragment is rejected.
    const hostUrl = new URL(`${proto}://${host}`);
    if (
      hostUrl.username
      || hostUrl.password
      || hostUrl.pathname !== "/"
      || hostUrl.search
      || hostUrl.hash
      || hostUrl.port
      || hostUrl.host !== host
    ) {
      return null;
    }

    return new URL(`${proto}://${host}:${port}`).origin;
  } catch {
    return null;
  }
}

/**
 * Determine the externally visible dashboard origin for a mutation. Production
 * requests carry all three Nginx-overwritten forwarding fields. Direct,
 * loopback-only development and isolated fixture requests carry none, so they
 * may use their exact browser Origin instead. The same exact-origin parser and
 * allowlist check below make that direct Origin trusted. Partial or malformed
 * forwarding metadata never reaches this fallback.
 */
export function externalDashboardOrigin(request: NextRequest): string | null {
  if (hasForwardedOriginMetadata(request.headers)) {
    return externalOriginFromForwardedHeaders(request.headers);
  }
  const origin = request.headers.get("origin");
  return origin && parseExactDashboardOrigin(origin) === origin ? origin : null;
}

/**
 * Validate the browser-side CSRF contract before a mutation can reach the
 * internal API. The browser Origin must exactly equal a trusted origin derived
 * from Nginx-overwritten external metadata, except for direct requests that
 * have no forwarding-origin metadata at all.
 */
export function hasValidDashboardMutationContract(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || parseExactDashboardOrigin(origin) !== origin) return false;

  const externalOrigin = externalDashboardOrigin(request);
  const allowedOrigins = getDashboardAllowedOrigins();
  if (
    !externalOrigin
    || externalOrigin !== origin
    || !isTrustedDashboardOrigin(externalOrigin, allowedOrigins)
  ) return false;

  return request.headers.get(DASHBOARD_MARKER_HEADER) === DASHBOARD_MARKER_VALUE;
}

/**
 * Authenticate dashboard-to-API rewrites on the server.
 *
 * Returning `NextResponse.next()` preserves the existing next.config.js
 * rewrite destination and therefore preserves all API methods, bodies,
 * query strings, response status codes, and response bodies. The modified
 * request headers are consumed by Next.js while forwarding that rewrite; the
 * bearer token is never a browser response header.
 */
export function proxy(request: NextRequest): NextResponse {
  const pageResponse = protectDashboardPage(request);
  if (pageResponse) return pageResponse;
  if (isRuntimeGatewayPrivatePath(request.nextUrl.pathname)) return gatewayPrivateResponse();

  const browserSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const publicAuthentication = request.nextUrl.pathname.startsWith("/api/v1/auth/");
  const operatorBootstrap = request.nextUrl.pathname.startsWith("/api/v1/bootstrap/");
  if (!browserSession && !publicAuthentication && !operatorBootstrap) return authenticationRequiredResponse();

  if (
    isUnsafeDashboardMethod(request.method)
    && !hasValidDashboardMutationContract(request)
  ) {
    return csrfRejectedResponse();
  }

  const token = browserSession || publicAuthentication ? null : getDashboardApiToken();
  if (!token && !browserSession && !publicAuthentication) return missingTokenResponse();

  const headers = buildDashboardApiProxyHeaders(request.headers, token);
  return NextResponse.next({ request: { headers } });
}
