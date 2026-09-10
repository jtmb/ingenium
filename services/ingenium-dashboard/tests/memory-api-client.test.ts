import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

const requestMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  requestMock.mockReset();
});

describe("explicit memory API client", () => {
  it("lists the bounded private project and workspace scope", async () => {
    requestMock.mockResolvedValue(new Response(JSON.stringify({ data: { items: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    installDashboardFetchMock(requestMock);

    await api.memory.list("project/one", "workspace/one");

    expect(requestMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/memory?project=project%2Fone&workspaceId=workspace%2Fone&visibility=private&limit=16&tokenBudget=2048",
    );
  });

  it("reconciles an unknown save outcome before returning a committed receipt", async () => {
    const receipt = { status: "committed", operationId: "memory-operation", version: 1 };
    requestMock
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "committed", receipt } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    installDashboardFetchMock(requestMock);

    const result = await api.memory.save("project/one", {
      operationId: "memory-operation",
      workspaceId: "workspace/one",
      content: "Synthetic fact",
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/memory/operations/memory-operation?project=project%2Fone&workspaceId=workspace%2Fone",
    );
    expect(result.data).toMatchObject({ receipt, idempotent: true, reconciled: true });
  });

  it("returns a pending outcome rather than replaying an unconfirmed mutation", async () => {
    requestMock.mockRejectedValue(new TypeError("connection closed"));
    installDashboardFetchMock(requestMock);

    const result = await api.memory.forget("project", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      operationId: "memory-operation",
      workspaceId: "workspace",
      expectedVersion: 2,
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ status: "pending", operationId: "memory-operation", nextAction: "memory_operation_status" });
  });
});
