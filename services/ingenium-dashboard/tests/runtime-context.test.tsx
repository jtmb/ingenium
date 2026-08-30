import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeWorkspaceController } from "../src/lib/use-runtime-launch";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  workspace: {} as RuntimeWorkspaceController,
  workspaceScopes: [] as Array<{ userId: string; projectName: string }>,
  userId: "user-one",
  projectName: "runtime-project",
}));
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, request: mocks.request };
});
vi.mock("../src/lib/use-runtime-launch", () => ({
  useRuntimeWorkspace: (scope: { userId: string; projectName: string }) => {
    mocks.workspaceScopes.push(scope);
    return mocks.workspace;
  },
}));
vi.mock("../src/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: mocks.userId } }) }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => mocks.projectName }));

import { RuntimeProvider, useRuntime } from "../src/lib/RuntimeContext";

function Probe() {
  const runtime = useRuntime();
  return <button type="button" disabled={!runtime.client} onClick={() => { void runtime.client?.mcp.status(); }}>
    {runtime.client ? `Runtime ready: ${runtime.projectName}` : "Runtime required"}
  </button>;
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({ data: {} });
  mocks.workspaceScopes = [];
  mocks.userId = "user-one";
  mocks.projectName = "runtime-project";
});

afterEach(cleanup);

describe("shared Dashboard runtime binding", () => {
  it("does not create an OpenCode client before explicit runtime confirmation", () => {
    mocks.workspace = { mode: "isolated", status: "selecting", confirmedRuntimeId: null, confirmedProjectName: null } as RuntimeWorkspaceController;
    render(<RuntimeProvider><Probe /></RuntimeProvider>);
    expect((screen.getByRole("button", { name: "Runtime required" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("binds every client call to the confirmed authorized runtime", async () => {
    const runtimeId = "11111111-1111-4111-8111-111111111111";
    mocks.workspace = { mode: "isolated", status: "ready", confirmedRuntimeId: runtimeId, confirmedProjectName: "runtime-project" } as RuntimeWorkspaceController;
    render(<RuntimeProvider><Probe /></RuntimeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Runtime ready: runtime-project" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(`/opencode/mcp?runtime_id=${runtimeId}`, undefined));
  });

  it("rebinds the full-page runtime controller when the account or project scope changes", () => {
    mocks.workspace = { mode: "isolated", status: "selecting", confirmedRuntimeId: null, confirmedProjectName: null } as RuntimeWorkspaceController;
    const view = render(<RuntimeProvider><Probe /></RuntimeProvider>);
    expect(mocks.workspaceScopes.at(-1)).toEqual({ userId: "user-one", projectName: "runtime-project" });

    mocks.userId = "user-two";
    mocks.projectName = "other-project";
    view.rerender(<RuntimeProvider><Probe /></RuntimeProvider>);

    expect(mocks.workspaceScopes.at(-1)).toEqual({ userId: "user-two", projectName: "other-project" });
  });
});
