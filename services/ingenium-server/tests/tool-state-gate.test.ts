import { describe, expect, it, vi } from "vitest";
import {
  ProjectStateAttestor,
  getToolAuthorizationPolicy,
  launcherBoundStateGatedHandler,
  policyStateGatedHandler,
  responseProjectMatches,
  stateGatedHandler,
  TOOL_STATE_GATE_CODES,
} from "../lib/tool-state-gate.js";

describe("stateGatedHandler", () => {
  it("rejects retained missing, disabled, and unavailable scoped calls before their handler runs", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "must-not-run" }] }));
    const checkState = vi.fn(async () => "disabled" as const);
    const retainedHandler = stateGatedHandler(
      "ingenium_fixture_scoped",
      (args) => typeof args.project === "string" ? args.project : null,
      checkState,
      handler,
    );

    await expect(retainedHandler({})).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.project) }],
    });
    expect(checkState).not.toHaveBeenCalled();

    await expect(retainedHandler({ project: "fixture-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.disabled) }],
    });
    checkState.mockResolvedValueOnce("unavailable");
    await expect(retainedHandler({ project: "fixture-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.unavailable) }],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses the launcher project for a catalog-global schema without adding a project argument", async () => {
    const handler = vi.fn(async (args) => ({ content: [{ type: "text", text: args.name }] }));
    const checkState = vi.fn(async () => "enabled" as const);
    const gated = stateGatedHandler(
      "ingenium_project_detail",
      () => "launcher-project",
      checkState,
      handler,
    );

    await expect(gated({ name: "target-project" })).resolves.toMatchObject({
      content: [{ text: "target-project" }],
    });
    expect(checkState).toHaveBeenCalledWith("ingenium_project_detail", "launcher-project");
    expect(handler).toHaveBeenCalledWith({ name: "target-project" });
  });

  it("rejects foreign projects and checks disabled launcher-bound calls against only the launcher project", async () => {
    const handler = vi.fn(async (args) => ({ content: [{ type: "text", text: args.project }] }));
    const checkState = vi.fn(async () => "disabled" as const);
    const gated = launcherBoundStateGatedHandler(
      "ingenium_repository_sync",
      "launcher-project",
      checkState,
      handler,
    );

    await expect(gated({ project: "foreign-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.project) }],
    });
    expect(checkState).not.toHaveBeenCalled();

    await expect(gated({ project: "launcher-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.disabled) }],
    });
    expect(checkState).toHaveBeenCalledWith("ingenium_repository_sync", "launcher-project");
    expect(handler).not.toHaveBeenCalled();

    checkState.mockResolvedValueOnce("enabled");
    await expect(gated({ project: "launcher-project" })).resolves.toMatchObject({
      content: [{ text: "launcher-project" }],
    });
    expect(handler).toHaveBeenCalledWith({ project: "launcher-project" });
  });

  it("requires exact project and project_id attestations, then binds each name immutably", () => {
    const attestor = new ProjectStateAttestor();
    const first = { project: "launcher-project", project_id: "launcher-project-id", data: {} };

    expect(responseProjectMatches({ data: [] }, "launcher-project")).toBe(false);
    expect(responseProjectMatches({ project: "launcher-project" }, "launcher-project")).toBe(false);
    expect(responseProjectMatches(first, "launcher-project")).toBe(true);
    expect(responseProjectMatches({ ...first, project: "other-project" }, "launcher-project")).toBe(false);
    expect(attestor.attest("launcher-project", first)).toBe(true);
    expect(attestor.attest("launcher-project", { ...first, project_id: "changed-project-id" })).toBe(false);

    expect(attestor.attest("other-project", {
      project: "other-project",
      project_id: "other-project-id",
    })).toBe(true);
  });

  it("fails a retained built-in invocation closed when its state attestation changes", async () => {
    const attestor = new ProjectStateAttestor();
    let response = {
      project: "fixture-project",
      project_id: "fixture-project-id",
      data: { enabled: true },
    };
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "called" }] }));
    const retainedHandler = stateGatedHandler(
      "ingenium_fixture_scoped",
      (args) => typeof args.project === "string" ? args.project : null,
      async (_tool, project) => attestor.attest(project, response) ? "enabled" : "unavailable",
      handler,
    );

    await expect(retainedHandler({ project: "fixture-project" })).resolves.toMatchObject({
      content: [{ text: "called" }],
    });

    response = { ...response, project_id: "changed-project-id" };
    await expect(retainedHandler({ project: "fixture-project" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.unavailable) }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails closed without policy and enforces launcher binding before dispatch", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "called" }] }));
    const missing = policyStateGatedHandler("ingenium_fixture", "launcher", async () => ({ state: "enabled" }), handler);
    await expect(missing({ project: "launcher" })).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.unavailable) }] });

    const bound = policyStateGatedHandler("ingenium_fixture", "launcher", async () => ({
      state: "enabled",
      policy: { action: "tasks.read", resource: "tasks", permission: "read", target: "project", scopes: ["tasks:read"], launcherBinding: "required" },
    }), handler);
    await expect(bound({ project: "foreign" })).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining(TOOL_STATE_GATE_CODES.project) }] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects malformed authorization metadata", () => {
    expect(getToolAuthorizationPolicy({ action: "tasks.read", resource: "tasks", permission: "read", target: "project", scopes: [], launcherBinding: "required" })).toBeNull();
    expect(getToolAuthorizationPolicy({ action: "tasks.read", resource: "tasks", permission: "owner", target: "project", scopes: ["tasks:read"], launcherBinding: "required" })).toBeNull();
    expect(getToolAuthorizationPolicy({ action: "tasks.read", resource: "tasks", permission: "read", target: "project", scopes: ["tasks:read"], launcherBinding: "required" })).toMatchObject({ permission: "read", target: "project" });
  });
});
