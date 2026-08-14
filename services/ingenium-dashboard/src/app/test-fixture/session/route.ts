import { loadDashboardApiToken } from "../../../lib/dashboard-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Resource not found" } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

function fixtureEnvironment(request: Request): {
  apiPort: number;
  dashboardOrigin: string;
  nonce: string;
  project: string;
  token: string;
} | { error: string } | undefined {
  const environment: Readonly<Record<string, string | undefined>> = process.env;
  const nonce = environment["INGENIUM_TEST_RUN_NONCE"];
  const project = environment["INGENIUM_PROJECT"];
  const token = loadDashboardApiToken(environment);
  const apiPort = Number(environment["INGENIUM_API_PORT"]);
  const url = new URL(request.url);
  if (environment["INGENIUM_API_TEST_MODE"] !== "1"
    || !nonce
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)
    || !project?.startsWith("playwright-test-")) return undefined;
  if (!token) return { error: "Fixture dashboard credential is unavailable" };
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65_535) {
    return { error: "Fixture API port is unavailable" };
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    return { error: "Fixture dashboard origin is invalid" };
  }
  return { apiPort, dashboardOrigin: url.origin, nonce, project, token };
}

export async function GET(request: Request): Promise<Response> {
  const fixture = fixtureEnvironment(request);
  if (!fixture) return unavailable();
  if ("error" in fixture) {
    return Response.json(
      { error: { code: "FIXTURE_UNAVAILABLE", message: fixture.error } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`http://127.0.0.1:${fixture.apiPort}/api/v1/auth/fixture-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        "x-ingenium-fixture-run-nonce": fixture.nonce,
        "x-ingenium-internal-service": "1",
      },
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: { code: "FIXTURE_UNAVAILABLE", message: "Fixture session is unavailable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const cookie = upstream.headers.get("set-cookie");
  if (!upstream.ok || !cookie) {
    return Response.json(
      { error: { code: "FIXTURE_UNAVAILABLE", message: "Fixture session is unavailable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const location = new URL("/", fixture.dashboardOrigin);
  location.searchParams.set("project", fixture.project);
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: location.toString(),
      "Set-Cookie": cookie,
    },
  });
}
