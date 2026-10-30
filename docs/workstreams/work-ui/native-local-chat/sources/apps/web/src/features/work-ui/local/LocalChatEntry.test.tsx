import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Gateway } from "../../../platform/types";
import { LocalChatEntry } from "./LocalChatEntry";

const windows = { environment: { kind: "windows" }, label: "Verified Windows", selection_source: "native_windows_custody" };
const wsl = { environment: { kind: "wsl", distro: "Saved distro", user: "saved-user" }, label: "Saved WSL", selection_source: "recorded_project" };
function context(environments: unknown[], default_environment: unknown) {
  return { library_id: "actual-library", service_instance_id: "actual-service", custodian: { key: "actual-custodian" }, environments, default_environment };
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const effects = (rpc: { mock: { calls: readonly (readonly unknown[])[] } }) => rpc.mock.calls.filter(([method]) => method === "POST");

describe("server-selected local chat entry", () => {
  it("offers only actual saved WSL environments with no implicit OS/default user or allocation", async () => {
    const rpc = vi.fn(async () => context([wsl], null)), gateway: Pick<Gateway, "workbench"> = { workbench: rpc };
    render(<LocalChatEntry gateway={gateway} available />);
    await screen.findByRole("option", { name: "Saved WSL" });
    const select = screen.getByLabelText("Local chat environment") as HTMLSelectElement;
    expect(select.value).toBe(""); expect(screen.queryByRole("option", { name: /Windows/ })).toBeNull();
    expect(screen.getByRole("button", { name: "New local chat" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(select, { target: { value: JSON.stringify(wsl.environment) } });
    await screen.findByRole("heading", { name: "What should we build?" });
    expect((screen.getByLabelText("Local chat environment") as HTMLSelectElement).value).toBe(JSON.stringify(wsl.environment)); expect(effects(rpc)).toHaveLength(0);
    expect((screen.getByText("Composer options").parentElement as HTMLDetailsElement).open).toBe(false);
  });
  it("preserves an unavailable state with no environment candidate and sends no effect", async () => {
    const rpc = vi.fn(async () => context([], null));
    render(<LocalChatEntry gateway={{ workbench: rpc }} available />);
    await screen.findByText(/No local environment is available/);
    expect(screen.queryByLabelText("Local chat environment")).toBeNull();
    expect(screen.getByRole("button", { name: "New local chat" }).hasAttribute("disabled")).toBe(true);
    expect(effects(rpc)).toHaveLength(0);
  });
  it("discards a late previous-connection context without showing its environment or sending", async () => {
    let finish!: (value: unknown) => void;
    const oldRpc = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; })), nextRpc = vi.fn(async () => context([wsl], null));
    const view = render(<LocalChatEntry gateway={{ workbench: oldRpc }} available connectionEpoch="old" />);
    await waitFor(() => expect(oldRpc).toHaveBeenCalled());
    view.rerender(<LocalChatEntry gateway={{ workbench: nextRpc }} available connectionEpoch="new" />);
    await screen.findByRole("option", { name: "Saved WSL" });
    await act(async () => { finish(context([windows], windows.environment)); });
    expect(screen.queryByRole("option", { name: "Verified Windows" })).toBeNull();
    expect(effects(oldRpc)).toHaveLength(0); expect(effects(nextRpc)).toHaveLength(0);
  });
  it("starts only the actual selected workspace, automatically reads readiness, and retains the draft on stopped engine", async () => {
    let owner: unknown;
    const rpc = vi.fn(async (method: "GET" | "POST", path: string, body?: unknown) => {
      if (method === "GET" && path === "/v1/local-workspaces/context") return context([windows], windows.environment);
      if (method === "POST" && path === "/v1/local-workspaces/") {
        const request = body as { request_id: string; environment: unknown };
        expect(request.environment).toEqual(windows.environment);
        owner = { installation_id: "actual-library", custodian_key: "actual-custodian", workspace_id: request.request_id, revision: 0, service_instance_id: "actual-service", environment: request.environment };
        return { owner, workspace: { id: request.request_id, revision: 0, environment: request.environment, state: "active", root_path: "C:\\private\\actual", root_identity: "actual-root" } };
      }
      if (method === "GET" && path.endsWith("/runtime")) return { owner, ready: false, reason: "engine_stopped" };
      throw Error("Unexpected route in readiness test");
    });
    render(<LocalChatEntry gateway={{ workbench: rpc }} available />);
    await waitFor(() => expect(screen.getByLabelText("Local message").hasAttribute("disabled")).toBe(false));
    expect(effects(rpc)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Local message"), { target: { value: "Keep draft while unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await screen.findByText(/The local engine is stopped/);
    expect((screen.getByLabelText("Local message") as HTMLTextAreaElement).value).toBe("Keep draft while unavailable");
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
    expect(effects(rpc)).toHaveLength(1); expect(effects(rpc)[0][1]).toBe("/v1/local-workspaces/");
    expect((screen.getByText("Runtime details").parentElement as HTMLDetailsElement).open).toBe(false);
  });
  it("opens the fresh first view with the Work hero and bottom composer without any backend effect", async () => {
    const rpc = vi.fn(async () => context([windows], windows.environment));
    render(<LocalChatEntry gateway={{ workbench: rpc }} available />);
    const hero = await screen.findByRole("heading", { name: "What should we build?" });
    expect(hero.closest(".native-local-transcript")).toBeTruthy();
    const input = screen.getByLabelText("Local message");
    await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
    expect(input.closest(".native-local-composer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Work", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Start chat" }).hasAttribute("disabled")).toBe(false);
    expect((screen.getByText("Composer options").parentElement as HTMLDetailsElement).open).toBe(false);
    expect(effects(rpc)).toHaveLength(0); expect(rpc.mock.calls).toHaveLength(1);
  });
  it("retains the same fresh draft and mounted composer across Web return and restores it on remount", async () => {
    const rpc = vi.fn(async () => context([windows], windows.environment)), gateway = { workbench: rpc };
    const view = render(<LocalChatEntry gateway={gateway} available />);
    await waitFor(() => expect(screen.getByLabelText("Local message").hasAttribute("disabled")).toBe(false));
    const input = screen.getByLabelText("Local message") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep fresh draft 日本語" } });
    await waitFor(() => expect(Object.values(localStorage).some(value => String(value).includes("Keep fresh draft 日本語"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    expect(screen.getByText("Web is unavailable for this conversation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to Work" }));
    expect(screen.getByLabelText("Local message")).toBe(input); expect(input.value).toBe("Keep fresh draft 日本語");
    view.unmount(); render(<LocalChatEntry gateway={gateway} available />);
    await waitFor(() => expect((screen.getByLabelText("Local message") as HTMLTextAreaElement).value).toBe("Keep fresh draft 日本語"));
    expect(effects(rpc)).toHaveLength(0); expect(document.querySelector("iframe")).toBeNull();
  });
});
