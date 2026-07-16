import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware to inject HTTP Basic Auth header for OpenCode proxy requests.
 *
 * The OpenCode Web server requires HTTP Basic Auth (OPENCODE_SERVER_PASSWORD).
 * This middleware intercepts requests to /opencode-proxy/*, reads the password
 * from the server environment, and adds the Authorization header before the
 * Next.js rewrite rule proxies the request to the OpenCode backend.
 *
 * The password never reaches the browser — the iframe simply loads
 * /opencode-proxy/ (a same-origin path), and the server handles auth transparently.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/opencode-proxy/")) {
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    if (!password) {
      return new NextResponse("OpenCode password not configured", { status: 500 });
    }
    const token = Buffer.from(`opencode:${password}`).toString("base64");
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Authorization", `Basic ${token}`);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }
  // Pass through requests that don't match the proxy path
  return NextResponse.next();
}
