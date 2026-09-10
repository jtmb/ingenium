import { describe, expect, it } from "vitest";
import type { Request } from "express";
import type { RequestPrincipal } from "../lib/middleware/auth.js";
import { requestAuthorizationPrincipal, requestOwnerScope } from "../lib/helpers.js";

const authorizationPolicy = {
  action: "observations.read",
  resource: "observations",
  permission: "read" as const,
  target: "project" as const,
};

function request(principal?: RequestPrincipal, withPolicy = true): Request {
  return {
    principal,
    authorizationPolicy: withPolicy ? authorizationPolicy : undefined,
  } as Request;
}

describe("request owner scope", () => {
  it("keeps direct-router compatibility and undefined-policy behavior", () => {
    const direct = request();
    expect(requestAuthorizationPrincipal(direct)).toEqual({
      type: "compatibility",
      id: "direct-router",
      scopes: ["*"],
    });
    expect(requestOwnerScope(direct)).toBeNull();
    expect(requestOwnerScope(request({ type: "user", id: "user-1", scopes: [] }, false))).toBeUndefined();
  });

  it("projects browser and token users to their owner and other principals to organization scope", () => {
    const browser = request({
      type: "user",
      id: "browser-user",
      scopes: [],
      session: {} as never,
    });
    const token = request({ type: "user", id: "token-user", scopes: [], tokenId: "token-1" });
    const service = request({
      type: "service",
      id: "service-1",
      scopes: [],
      tokenId: "service-token",
      organizationId: null,
      projectId: null,
    });

    expect(requestAuthorizationPrincipal(browser).type).toBe("browser-user");
    expect(requestOwnerScope(browser)).toBe("browser-user");
    expect(requestAuthorizationPrincipal(token).type).toBe("user-token");
    expect(requestOwnerScope(token)).toBe("token-user");
    expect(requestAuthorizationPrincipal(service).type).toBe("service-principal");
    expect(requestOwnerScope(service)).toBeNull();
  });
});
