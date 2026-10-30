import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalChatController, type OriginalStore } from "./local-chat-controller.mjs";
import type { LocalTransport } from "./local-protocol.mjs";
import { LocalChatPanel } from "./LocalChatPanel";

afterEach(cleanup);
function fixture() {
  const values = new Map<string, string>();
  const store: OriginalStore = { read: key => values.get(key) ?? null,
    put: (key, previous, next) => { if ((values.get(key) ?? null) !== previous) throw Error("changed"); values.set(key, next); },
    withLock: async (_key, work) => work() };
  const transport: LocalTransport = { createWorkspace: vi.fn(), readWorkspace: vi.fn(), dispatch: vi.fn(), readReceipt: vi.fn(), readSession: vi.fn(),
    readContext: vi.fn(), readRuntime: vi.fn(), readSessions: vi.fn(), readMessages: vi.fn(), readStatus: vi.fn() };
  const identity = { installation_id: "actual-library", custodian_key: "actual-custodian", service_instance_id: "actual-instance", environment: { kind: "windows" as const } };
  const controller = new LocalChatController({ identity, flowID: "11111111-1111-4111-8111-111111111111", store, transport, current: () => true });
  return { controller, transport, identity };
}
describe("local Work presentation proposal", () => {
  it("retains the same durable draft through explicit Web return without allocation or submission", async () => {
    const f = fixture();
    render(<LocalChatPanel controller={f.controller} admission={{ kind: "observed", identity: f.identity, canRequest: true, message: "Read private runtime first." }} />);
    await waitFor(() => expect(screen.getByLabelText("Local message").hasAttribute("disabled")).toBe(false));
    const input = screen.getByLabelText("Local message") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Retain exact private draft 日本語" } });
    await waitFor(() => expect(f.controller.getSnapshot().journal?.draft).toBe("Retain exact private draft 日本語"));
    fireEvent.click(screen.getByRole("button", { name: "Web", exact: true }));
    expect(screen.getByText("Web is unavailable for this conversation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to Work" }));
    expect(screen.getByLabelText("Local message")).toBe(input);
    expect(input.value).toBe("Retain exact private draft 日本語");
    expect(f.transport.createWorkspace).not.toHaveBeenCalled(); expect(f.transport.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(true);
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("keeps an unconfirmed context unavailable and refuses premature Enter sends", async () => {
    const f = fixture();
    render(<LocalChatPanel controller={f.controller} admission={{ kind: "unavailable", message: "Original custody unavailable." }} />);
    await waitFor(() => expect(screen.getByLabelText("Local message").hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("Local message"), { target: { value: "Keep on unavailable" } });
    fireEvent.keyDown(screen.getByLabelText("Local message"), { key: "Enter" });
    await waitFor(() => expect(f.controller.getSnapshot().journal?.draft).toBe("Keep on unavailable"));
    expect(screen.getByRole("button", { name: "Prepare private workspace" }).hasAttribute("disabled")).toBe(true);
    expect(f.transport.createWorkspace).not.toHaveBeenCalled(); expect(f.transport.dispatch).not.toHaveBeenCalled();
  });
});
