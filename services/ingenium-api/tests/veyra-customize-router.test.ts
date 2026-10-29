import { describe, expect, it } from "vitest";
import { createCustomizeRouter } from "../lib/customize-v2/router.js";
import type { CustomizeAuthority, CustomizeContext } from "../lib/customize-v2/catalog-service.js";

function fixture(overrides: Partial<CustomizeAuthority> = {}, context: CustomizeContext | null = { actorId: "owner", projectId: "project-a" }) {
  let reads = 0;
  const router = createCustomizeRouter({
    resolveContext: () => context,
    authority: {
      authorize: () => true,
      scopes: () => ["project"],
      installed: () => { reads++; return [{ id: "skill", kind: "skill", name: "Release checks", enabled: 1 }]; },
      discover: () => [],
      resource: () => null,
      mutate: async () => ({ operationId: "unused", outcome: "failed" }),
      ...overrides,
    },
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/")!.route!.stack[0]!.handle;
  async function invoke(query: Record<string, unknown> = {}) {
    let status = 200;
    let payload: unknown;
    const headers = new Map<string, string>();
    const response = {
      headersSent: false,
      setHeader(name: string, value: string) { headers.set(name, value); },
      status(value: number) { status = value; return response; },
      json(value: unknown) { payload = value; response.headersSent = true; return response; },
    };
    await handler({ query }, response, () => undefined);
    return { status, payload, headers };
  }
  return { invoke, readCount: () => reads };
}

describe("Customize catalog HTTP boundary", () => {
  it("returns paginated, non-cacheable scoped rows", async () => {
    const { invoke } = fixture();
    const result = await invoke({ kind: "skill" });
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.payload).toMatchObject({
      data: [{ id: "skill", installed: true }],
      pagination: { total: 1, hasMore: false },
      scope: { projectId: "project-a" },
    });
  });

  it("rejects unresolved auth context before any data read", async () => {
    const { invoke, readCount } = fixture({}, null);
    expect((await invoke()).status).toBe(401);
    expect(readCount()).toBe(0);
  });

  it("retains forbidden, validation and unavailable-scope errors", async () => {
    expect((await fixture({ authorize: () => false }).invoke()).status).toBe(403);
    expect((await fixture().invoke({ limit: "101" })).status).toBe(400);
    expect((await fixture().invoke({ visibility: "personal" })).status).toBe(409);
  });

  it("redacts unexpected owner failures", async () => {
    const result = await fixture({ installed: () => { throw new Error("private path or SQL details"); } }).invoke();
    expect(result.status).toBe(500);
    expect(result.payload).toEqual({ error: { code: "INTERNAL_ERROR", message: "Catalog could not be loaded." } });
  });
});
