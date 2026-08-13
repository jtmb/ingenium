import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE, isPublicAuthPath, proxy, safeReturnTo } from "../src/proxy";
import { classifyAuthFailure } from "../src/lib/api";

describe("AUTH-103 dashboard boundary", () => {
  it("protects workspaces, standalone pages, settings URLs, route handlers, and SSE", () => {
    for (const path of ["/", "/standalone?page=opencode", "/projects?settings=security"]) {
      const response = proxy(new NextRequest(`http://dashboard.test${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login?returnTo=");
    }
    expect(proxy(new NextRequest("http://dashboard.test/api/v1/opencode/sessions/id/events")).status).toBe(401);
    expect(isPublicAuthPath("/login")).toBe(true);
  });

  it("accepts only local return targets and allows authenticated workspaces", () => {
    expect(safeReturnTo("/projects?settings=security#x")).toBe("/projects?settings=security#x");
    for (const unsafe of ["https://evil.example", "//evil.example", "/\\evil.example"]) expect(safeReturnTo(unsafe)).toBe("/");
    const request = new NextRequest("http://dashboard.test/standalone?page=opencode", { headers: { cookie: `${AUTH_SESSION_COOKIE}=fixture` } });
    expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("maps stable authentication errors", () => {
    expect(classifyAuthFailure(401, "UNAUTHORIZED")).toBe("session-expired");
    expect(classifyAuthFailure(403, "CSRF_REJECTED")).toBe("csrf");
    expect(classifyAuthFailure(403, "STEP_UP_REQUIRED")).toBe("reauth");
    expect(classifyAuthFailure(403, "EMAIL_VERIFICATION_REQUIRED")).toBe("verification");
    expect(classifyAuthFailure(403, "FORBIDDEN")).toBe("access-denied");
  });
});
