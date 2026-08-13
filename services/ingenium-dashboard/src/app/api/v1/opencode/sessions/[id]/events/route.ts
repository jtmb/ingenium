export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_API_PORT = 4097;

function apiPort(): number | null {
  const configured = process.env.INGENIUM_API_PORT ?? String(DEFAULT_API_PORT);
  if (!/^\d{1,5}$/.test(configured)) return null;

  const port = Number(configured);
  return port >= 1 && port <= 65_535 ? port : null;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Stream a session's OpenCode events without passing through a Next rewrite.
 *
 * Next rewrites proxy ordinary API responses well, but they buffer a response
 * body that remains open after OpenCode's `session.idle` event. OpenCode keeps
 * `/event` connections open for future events, so buffering leaves the chat UI
 * at a progress indicator until the page is refreshed. A route handler returns
 * the upstream ReadableStream directly, preserving each SSE frame and its
 * backpressure all the way to the browser.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const port = apiPort();
  if (!port) {
    return jsonError(
      503,
      "DASHBOARD_API_PROXY_MISCONFIGURED",
      "Dashboard API proxy is not configured",
    );
  }

  const { id } = await context.params;
  if (!id) {
    return jsonError(400, "INVALID_SESSION", "A session ID is required");
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `/api/v1/opencode/sessions/${encodeURIComponent(id)}/events`,
    `http://127.0.0.1:${port}`,
  );
  upstreamUrl.search = incomingUrl.search;

  const cookie = request.headers.get("cookie");
  if (!cookie) return jsonError(401, "UNAUTHORIZED", "Authentication is required");
  const headers = new Headers({ Accept: "text/event-stream", Cookie: cookie });
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId) headers.set("Last-Event-ID", lastEventId);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers,
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "API_UNAVAILABLE", "OpenCode event stream is unavailable");
  }

  const responseHeaders = new Headers({
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("Content-Type", contentType);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
